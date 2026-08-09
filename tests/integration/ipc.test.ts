import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerIpc,
  type IpcInvokeEvent,
  type IpcMainLike,
  type IpcSender
} from '../../src/main/ipc/registerIpc'
import { MemorySecretStore } from '../../src/main/settings/secretStore'
import { SettingsService } from '../../src/main/settings/settingsService'
import { TaskManager, type ManagedWorkerProcess } from '../../src/main/tasks/taskManager'
import {
  IPC_CHANNELS,
  type IpcResponseEnvelope,
  type TaskProgress,
  type VerificationReport,
  type WorkerRequest,
  type WorkerResponse
} from '../../src/shared/contracts'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'
import { writeExecutionResultFixture } from '../fixtures/builders/executionResultFixture'

const REQUEST_ID = '423e4567-e89b-42d3-a456-426614174000'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('versioned IPC and path capabilities', () => {
  it('rejects Renderer path injection and tokens owned by another Renderer', async () => {
    const harness = await createHarness()
    const selected = await harness.ipc.invoke(IPC_CHANNELS.filesSelectInputs, 1, {})
    expect(selected.ok).toBe(true)
    const selectedData = successData<{ files: Array<{ inputId: string }> }>(selected)
    const inputId = selectedData.files[0]?.inputId as string
    expect(JSON.stringify(selected)).not.toContain(harness.inputPath)

    const injected = await harness.ipc.invoke(IPC_CHANNELS.sanitizePreview, 1, {
      inputIds: [inputId],
      absolutePath: '/renderer/injected.docx'
    })
    expect(injected).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(harness.worker.messages).toEqual([])

    const crossOwner = await harness.ipc.invoke(IPC_CHANNELS.sanitizePreview, 2, {
      inputIds: [inputId]
    })
    expect(crossOwner).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(harness.worker.messages).toEqual([])
    harness.dispose()
  })

  it('translates selected tokens into internal snapshots and returns path-free results', async () => {
    const harness = await createHarness()
    const selected = await harness.ipc.invoke(IPC_CHANNELS.filesSelectInputs, 1, {})
    const inputId = successData<{ files: Array<{ inputId: string }> }>(selected).files[0]
      ?.inputId as string
    const previewInvocation = harness.ipc.invoke(IPC_CHANNELS.sanitizePreview, 1, {
      inputIds: [inputId]
    })
    const previewRequest = harness.worker.messages[0]
    if (!previewRequest || previewRequest.type !== 'preview')
      throw new Error('Missing preview request')
    expect(previewRequest.inputs[0]?.snapshot.absolutePath).toBe(harness.inputPath)
    const taskId = previewRequest.taskId
    const preview = {
      schemaVersion: 1 as const,
      taskId,
      planDigest: 'c'.repeat(64),
      createdAt: '2026-08-09T10:00:00+08:00',
      files: [
        {
          inputId,
          displayName: basename(harness.inputPath),
          documentType: 'docx' as const,
          size: previewRequest.inputs[0]?.snapshot.size as number,
          fields: [],
          warnings: [],
          blockers: []
        }
      ]
    }
    harness.worker.respond(progressMessage(taskId, 'previewing', 0.1))
    harness.worker.respond(progressMessage(taskId, 'awaiting-confirmation', 0.9))
    harness.worker.respond({ schemaVersion: 1, type: 'preview-result', preview })
    const previewResponse = await previewInvocation
    expect(previewResponse).toMatchObject({ ok: true, data: preview })

    const selectedOutput = await harness.ipc.invoke(IPC_CHANNELS.filesSelectOutput, 1, {})
    const outputDirectoryId = successData<{ outputDirectoryId: string }>(
      selectedOutput
    ).outputDirectoryId
    const executionInvocation = harness.ipc.invoke(IPC_CHANNELS.sanitizeExecute, 1, {
      schemaVersion: 1,
      taskId,
      planDigest: preview.planDigest,
      outputDirectoryId,
      acknowledged: true
    })
    await vi.waitFor(() => expect(harness.worker.messages.at(-1)?.type).toBe('execute'))
    const executeRequest = harness.worker.messages.at(-1)
    if (!executeRequest || executeRequest.type !== 'execute') {
      throw new Error('Missing execute request')
    }
    expect(executeRequest.outputDirectory).toBe(harness.outputDirectory)
    const result = await writeExecutionResultFixture({
      taskId,
      inputSha256: previewRequest.inputs[0]?.snapshot.sha256 as string,
      inputDisplayName: basename(harness.inputPath),
      outputDirectory: harness.outputDirectory,
      workspaceRootPath: harness.workspaceRootPath
    })
    harness.worker.respond(progressMessage(taskId, 'running', 0.2))
    harness.worker.respond(progressMessage(taskId, 'verifying', 0.8))
    harness.worker.respond(progressMessage(taskId, 'completed', 1, result.completionVerification))
    const ownerSender = harness.senders.get(1)
    if (ownerSender) ownerSender.throwOnSend = true
    harness.worker.respond({ schemaVersion: 1, type: 'execute-result', result })

    const executionResponse = await executionInvocation
    expect(executionResponse.ok).toBe(true)
    expect(JSON.stringify(executionResponse)).not.toContain(harness.outputDirectory)
    const publicResult = successData<{
      files: Array<{ fileId: string; kind: string }>
    }>(executionResponse)
    expect(publicResult.files).toHaveLength(3)
    const outputFileId = publicResult.files.find((file) => file.kind === 'sanitized-document')
      ?.fileId as string

    const crossOwnerOpen = await harness.ipc.invoke(IPC_CHANNELS.filesOpenResult, 2, {
      fileId: outputFileId
    })
    expect(crossOwnerOpen).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    const opened = await harness.ipc.invoke(IPC_CHANNELS.filesOpenResult, 1, {
      fileId: outputFileId
    })
    expect(opened).toMatchObject({ ok: true })
    expect(harness.shownPaths).toEqual([result.outputPaths[0]])
    expect(harness.senders.get(1)?.events.map((event) => event.channel)).toContain(
      IPC_CHANNELS.taskSubscribe
    )
    harness.dispose()
  })

  it('rejects execute requests that omit explicit acknowledgement', async () => {
    const harness = await createHarness()
    const response = await harness.ipc.invoke(IPC_CHANNELS.sanitizeExecute, 1, {
      schemaVersion: 1,
      taskId: '123e4567-e89b-42d3-a456-426614174000',
      planDigest: 'c'.repeat(64),
      outputDirectoryId: '223e4567-e89b-42d3-a456-426614174000'
    })

    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(harness.worker.messages).toEqual([])
    harness.dispose()
  })

  it('cancels owned tasks and revokes capabilities when the Renderer is destroyed', async () => {
    const harness = await createHarness()
    const selected = await harness.ipc.invoke(IPC_CHANNELS.filesSelectInputs, 1, {})
    const inputId = successData<{ files: Array<{ inputId: string }> }>(selected).files[0]
      ?.inputId as string
    const previewInvocation = harness.ipc.invoke(IPC_CHANNELS.sanitizePreview, 1, {
      inputIds: [inputId]
    })
    const sender = harness.senders.get(1)
    sender?.destroy()

    expect(harness.worker.messages.at(-1)).toMatchObject({ type: 'cancel' })
    const request = harness.worker.messages[0]
    if (!request || request.type !== 'preview') throw new Error('Missing preview request')
    harness.worker.respond(progressMessage(request.taskId, 'cancelled', 0))
    await expect(previewInvocation).resolves.toMatchObject({
      ok: false,
      error: { code: 'TASK_CANCELLED' }
    })
    const revoked = await harness.ipc.invoke(IPC_CHANNELS.sanitizePreview, 1, {
      inputIds: [inputId]
    })
    expect(revoked).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    harness.dispose()
  })
})

async function createHarness(): Promise<{
  ipc: FakeIpcMain
  worker: FakeWorker
  inputPath: string
  outputDirectory: string
  workspaceRootPath: string
  shownPaths: string[]
  senders: Map<number, FakeSender>
  dispose(): void
}> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-ipc-'))
  temporaryDirectories.push(directory)
  const inputPath = join(directory, 'input.docx')
  const outputDirectory = join(directory, 'output')
  const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-runtime')
  await writeDocxFixture(inputPath)
  await import('node:fs/promises').then(({ mkdir }) => mkdir(outputDirectory))
  const ipc = new FakeIpcMain()
  const worker = new FakeWorker()
  const manager = new TaskManager(() => worker, {
    createWorkspace: async () => ({
      rootPath: workspaceRootPath,
      outputDirectory
    }),
    cleanupWorkspace: async () => undefined
  })
  const settingsService = new SettingsService(
    join(directory, 'settings.v1.json'),
    new MemorySecretStore()
  )
  const shownPaths: string[] = []
  const dispose = registerIpc({
    ipcMain: ipc,
    settingsService,
    taskManager: manager,
    appVersion: '0.1.0',
    selectInputPaths: async () => [inputPath],
    selectOutputDirectory: async () => outputDirectory,
    showResultInFolder: (absolutePath) => shownPaths.push(absolutePath)
  })
  return {
    ipc,
    worker,
    inputPath,
    outputDirectory,
    workspaceRootPath,
    shownPaths,
    senders: ipc.senders,
    dispose
  }
}

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<
    string,
    (event: IpcInvokeEvent, request: unknown) => Promise<IpcResponseEnvelope>
  >()
  readonly senders = new Map<number, FakeSender>()

  handle(
    channel: string,
    listener: (event: IpcInvokeEvent, request: unknown) => Promise<IpcResponseEnvelope>
  ): void {
    this.handlers.set(channel, listener)
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel)
  }

  async invoke(channel: string, ownerId: number, payload: unknown): Promise<IpcResponseEnvelope> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    let sender = this.senders.get(ownerId)
    if (!sender) {
      sender = new FakeSender(ownerId)
      this.senders.set(ownerId, sender)
    }
    return handler({ sender }, { schemaVersion: 1, requestId: REQUEST_ID, payload })
  }
}

class FakeSender implements IpcSender {
  readonly events: Array<{ channel: string; message: unknown }> = []
  throwOnSend = false
  #destroyListener: (() => void) | null = null
  #destroyed = false

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.#destroyed
  }

  send(channel: string, message: unknown): void {
    if (this.throwOnSend) throw new Error('synthetic sender failure')
    this.events.push({ channel, message })
  }

  once(event: 'destroyed', listener: () => void): void {
    if (event === 'destroyed') this.#destroyListener = listener
  }

  destroy(): void {
    this.#destroyed = true
    this.#destroyListener?.()
  }
}

class FakeWorker extends EventEmitter implements ManagedWorkerProcess {
  readonly messages: WorkerRequest[] = []

  postMessage(message: WorkerRequest): void {
    this.messages.push(message)
  }

  kill(): boolean {
    return true
  }

  respond(message: WorkerResponse): void {
    this.emit('message', message)
  }
}

function progressMessage(
  taskId: string,
  state: TaskProgress['state'],
  progress: number,
  verification?: VerificationReport
): WorkerResponse {
  return {
    schemaVersion: 1,
    type: 'progress',
    progress: {
      schemaVersion: 1,
      taskId,
      state,
      progress,
      message: `状态：${state}`,
      ...(verification ? { verification } : {})
    }
  }
}

function successData<T>(response: IpcResponseEnvelope): T {
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

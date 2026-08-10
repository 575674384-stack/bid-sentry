import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerIpc,
  type IpcInvokeEvent,
  type IpcMainLike,
  type IpcSender
} from '../../src/main/ipc/registerIpc'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { MemorySecretStore } from '../../src/main/settings/secretStore'
import { SettingsService } from '../../src/main/settings/settingsService'
import { buildReviewReport } from '../../src/core/review/report'
import {
  IPC_CHANNELS,
  type IpcResponseEnvelope,
  type ReviewResult,
  type GenerationAnalysis,
  type ReviewRequest
} from '../../src/shared/contracts'
import type { ReviewTaskManager } from '../../src/main/tasks/reviewTaskManager'
import type { GenerationTaskManager } from '../../src/main/tasks/generationTaskManager'
import type { TaskManager } from '../../src/main/tasks/taskManager'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('review and generation IPC ownership', () => {
  it('allows only the owning renderer to cancel an active review task', async () => {
    const fixture = await createFixture()
    let resolveRun: ((value: ReviewResult) => void) | undefined
    const reviewManager = {
      run: vi.fn(
        () =>
          new Promise<ReviewResult>((resolve) => {
            resolveRun = resolve
          })
      ),
      cancel: vi.fn()
    } as unknown as ReviewTaskManager
    const harness = await createIpcHarness(fixture, { reviewManager })
    const inputs = await harness.ipc.invoke(IPC_CHANNELS.filesSelectInputs, 1, {})
    const files = successData<{ files: Array<{ inputId: string }> }>(inputs).files
    const started = await harness.ipc.invoke(IPC_CHANNELS.reviewStart, 1, {})
    const reviewTaskId = successData<{ taskId: string }>(started).taskId
    const request: ReviewRequest = {
      schemaVersion: 1,
      taskId: reviewTaskId,
      tenderInputId: files[0]!.inputId,
      bidInputId: files[1]!.inputId,
      bidderName: '示例投标单位',
      aiConfirmed: false
    }
    const running = harness.ipc.invoke(IPC_CHANNELS.reviewRun, 1, request)
    await vi.waitFor(() => expect(reviewManager.run).toHaveBeenCalled())
    await expect(
      harness.ipc.invoke(IPC_CHANNELS.reviewCancel, 2, { taskId: reviewTaskId })
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    await harness.ipc.invoke(IPC_CHANNELS.reviewCancel, 1, { taskId: reviewTaskId })
    expect(reviewManager.cancel).toHaveBeenCalledWith(reviewTaskId)
    resolveRun?.({
      schemaVersion: 1,
      taskId: reviewTaskId,
      report: buildReviewReport(reviewTaskId, 'tender.docx', 'bid.docx', []),
      jsonReport: 'review.json',
      htmlReport: 'review.html',
      files: []
    })
    await running
    harness.dispose()
  })

  it('binds generation run and cancel to the renderer that created the analysis', async () => {
    const fixture = await createFixture(true)
    let resolveRun: (() => void) | undefined
    const input = await createInputSnapshot(fixture.inputPath)
    const analysis: GenerationAnalysis = {
      schemaVersion: 1,
      taskId: '723e4567-e89b-42d3-a456-426614174000',
      inputName: 'tender.docx',
      inputSha256: input.sha256,
      candidates: [
        {
          candidateId: 'a'.repeat(24),
          title: '资格标模板',
          startNodeId: 'p-0',
          endNodeId: 'p-0',
          sourceType: 'docx-template',
          sectionOutline: [],
          confidence: 0.9,
          reasons: ['synthetic']
        }
      ],
      extraction: {
        aiUsed: false,
        qualificationSummary: [],
        suggestedFields: [],
        notices: []
      }
    }
    const plan = {
      candidateId: 'a'.repeat(24),
      planId: '823e4567-e89b-42d3-a456-426614174000',
      planDigest: 'b'.repeat(64),
      inputSha256: input.sha256,
      actions: [],
      unknownRequired: 0,
      unknownFields: [],
      unresolvedFields: [],
      warnings: []
    }
    const generationManager = {
      analyze: vi.fn(async (_request, _input, taskId) => ({ ...analysis, taskId })),
      plan: vi.fn(async () => plan),
      hasTask: vi.fn(() => false),
      run: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve
          })
      ),
      cancel: vi.fn()
    } as unknown as GenerationTaskManager
    const harness = await createIpcHarness(fixture, { generationManager })
    const inputs = await harness.ipc.invoke(IPC_CHANNELS.filesSelectInputs, 1, {})
    const inputId = successData<{ files: Array<{ inputId: string }> }>(inputs).files[0]!.inputId
    const analyzeRequest = {
      schemaVersion: 1 as const,
      inputId
    }
    const analysisResult = successData<{ taskId: string }>(
      await harness.ipc.invoke(IPC_CHANNELS.generationAnalyze, 1, analyzeRequest)
    )
    const planRequest = {
      schemaVersion: 1 as const,
      analysisTaskId: analysisResult.taskId,
      candidateId: 'a'.repeat(24),
      userForm: {
        bidderName: '示例投标单位',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: '',
        projectName: '',
        sectionName: '',
        compilationDate: '',
        extraFields: []
      }
    }
    const generatedPlan = successData<{ planId: string }>(
      await harness.ipc.invoke(IPC_CHANNELS.generationPlan, 1, planRequest)
    )
    const runRequest = {
      schemaVersion: 1 as const,
      inputId,
      analysisTaskId: analysisResult.taskId,
      candidateId: 'a'.repeat(24),
      planId: generatedPlan.planId,
      planDigest: 'b'.repeat(64),
      confirmed: true as const
    }
    const running = harness.ipc.invoke(IPC_CHANNELS.generationRun, 1, runRequest)
    await vi.waitFor(() => expect(generationManager.run).toHaveBeenCalled())
    await expect(
      harness.ipc.invoke(IPC_CHANNELS.generationCancel, 2, { taskId: analysisResult.taskId })
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    await harness.ipc.invoke(IPC_CHANNELS.generationCancel, 1, {
      taskId: analysisResult.taskId
    })
    expect(generationManager.cancel).toHaveBeenCalledWith(analysisResult.taskId)
    resolveRun?.()
    await running
    harness.dispose()
  })
})

interface Fixture {
  directory: string
  inputPath: string
}

async function createFixture(qualificationTemplate = false): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-special-ipc-'))
  directories.push(directory)
  const inputPath = join(directory, 'tender.docx')
  const secondInputPath = join(directory, 'bid.docx')
  await writeDocxFixture(inputPath, {
    ...(qualificationTemplate ? { qualificationTemplate: true } : {})
  })
  await writeDocxFixture(secondInputPath)
  return { directory, inputPath }
}

async function createIpcHarness(
  fixture: Fixture,
  options: { reviewManager?: ReviewTaskManager; generationManager?: GenerationTaskManager }
): Promise<{ ipc: FakeIpcMain; dispose: () => void }> {
  const ipc = new FakeIpcMain()
  const taskManager = {
    cancel: vi.fn(),
    subscribe: () => () => undefined
  } as unknown as TaskManager
  const settingsService = new SettingsService(
    join(fixture.directory, 'settings.v2.json'),
    new MemorySecretStore()
  )
  const dispose = registerIpc({
    ipcMain: ipc,
    settingsService,
    taskManager,
    appVersion: '0.1.0',
    ...(options.reviewManager ? { reviewTaskManager: options.reviewManager } : {}),
    ...(options.generationManager ? { generationTaskManager: options.generationManager } : {}),
    selectInputPaths: async () => [fixture.inputPath, join(fixture.directory, 'bid.docx')],
    showResultInFolder: () => undefined
  })
  return { ipc, dispose }
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
    return handler(
      { sender },
      { schemaVersion: 1, requestId: '923e4567-e89b-42d3-a456-426614174000', payload }
    )
  }
}

class FakeSender implements IpcSender {
  constructor(readonly id: number) {}
  once(): void {
    // The test does not destroy its renderer.
  }
  isDestroyed(): boolean {
    return false
  }
  send(): void {
    // No progress channel is used by these managers.
  }
}

function successData<T>(response: IpcResponseEnvelope): T {
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

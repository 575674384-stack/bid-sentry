import { EventEmitter } from 'node:events'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TaskManager,
  TaskManagerError,
  type ManagedWorkerProcess,
  type TaskManagerOptions
} from '../../src/main/tasks/taskManager'
import { resolvePathIdentityWithoutSymbolicLinks } from '../../src/core/documents/pathSafety'
import type {
  TaskExecutionRequest,
  TaskProgress,
  VerificationReport,
  WorkerPreviewRequest,
  WorkerRequest,
  WorkerResponse
} from '../../src/shared/contracts'
import { writeExecutionResultFixture } from '../fixtures/builders/executionResultFixture'

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000'
const INPUT_ID = '223e4567-e89b-42d3-a456-426614174000'
const SHA_A = 'a'.repeat(64)
const TEST_IDENTITY = { device: '1', inode: '2', mode: '16877' } as const
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('TaskManager', () => {
  it('runs the allowed preview and verified execution transitions', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const worker = new FakeWorker()
    const cleaned: string[] = []
    const manager = createManager(worker, {
      cleanupWorkspace: async (workspace) => {
        cleaned.push(workspace.rootPath)
      }
    })
    const progressEvents: TaskProgress[] = []
    const unsubscribe = manager.subscribe((progress) => progressEvents.push(progress))

    const previewPromise = manager.preview(previewRequest(outputDirectory))
    worker.respond(progressMessage('previewing', 0.1))
    worker.respond(progressMessage('awaiting-confirmation', 0.9))
    worker.respond({ schemaVersion: 1, type: 'preview-result', preview: previewResult() })
    await expect(previewPromise).resolves.toEqual(previewResult())

    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    const result = await writeExecutionResultFixture({
      taskId: TASK_ID,
      inputSha256: SHA_A,
      inputDisplayName: 'input.docx',
      outputDirectory,
      workspaceRootPath
    })
    worker.respond(progressMessage('running', 0.2))
    worker.respond(progressMessage('verifying', 0.8))
    worker.respond(progressMessage('completed', 1, result.completionVerification))
    expect(progressEvents.at(-1)?.state).toBe('verifying')
    worker.respond({ schemaVersion: 1, type: 'execute-result', result })

    await expect(executionPromise).resolves.toEqual(result)
    expect(manager.activeCount).toBe(0)
    expect(worker.killed).toBe(true)
    expect(cleaned).toEqual([workspaceRootPath])
    expect(progressEvents.map((event) => event.state)).toEqual([
      'previewing',
      'awaiting-confirmation',
      'running',
      'verifying',
      'completed'
    ])
    unsubscribe()
    unsubscribe()
  })

  it('rejects malformed worker messages and impossible completion messages', async () => {
    for (const malformed of [
      { schemaVersion: 1, type: 'unknown', taskId: TASK_ID },
      {
        schemaVersion: 1,
        type: 'progress',
        progress: {
          schemaVersion: 1,
          taskId: TASK_ID,
          state: 'completed',
          progress: 1,
          message: '伪造完成。'
        }
      }
    ]) {
      const worker = new FakeWorker()
      const manager = createManager(worker)
      const events: TaskProgress[] = []
      manager.subscribe((progress) => events.push(progress))
      const previewPromise = manager.preview(previewRequest())

      worker.emit('message', malformed)

      await expect(previewPromise).rejects.toMatchObject({
        appError: { code: 'INTERNAL_ERROR' }
      })
      expect(worker.killed).toBe(true)
      expect(events.at(-1)).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR' } })
    }
  })

  it('fails safely when the worker exits unexpectedly', async () => {
    const worker = new FakeWorker()
    const manager = createManager(worker)
    const previewPromise = manager.preview(previewRequest())

    worker.emit('exit', 9)

    await expect(previewPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    expect(manager.activeCount).toBe(0)
  })

  it('settles and removes a task when worker startup messaging throws synchronously', async () => {
    const worker = new FakeWorker()
    worker.throwOnPost = true
    const manager = createManager(worker)

    await expect(manager.preview(previewRequest())).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    expect(manager.activeCount).toBe(0)
  })

  it('settles cancellation even when cancellation messaging and kill throw synchronously', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const worker = new FakeWorker()
    const manager = createManager(worker)
    await resolvePreview(manager, worker, outputDirectory)
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    worker.throwOnPost = true
    worker.throwOnKill = true

    manager.cancel(TASK_ID)

    await expect(executionPromise).rejects.toMatchObject({
      appError: { code: 'TASK_CANCELLED' }
    })
    expect(manager.activeCount).toBe(0)
  })

  it('does not let a throwing progress listener interrupt failure settlement', async () => {
    const worker = new FakeWorker()
    const manager = createManager(worker)
    manager.subscribe(() => {
      throw new Error('synthetic listener failure')
    })
    const previewPromise = manager.preview(previewRequest())

    worker.emit('message', { schemaVersion: 1, type: 'invalid' })

    await expect(previewPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    expect(manager.activeCount).toBe(0)
  })

  it('cancels an awaiting task and makes unsubscribe idempotent', async () => {
    const worker = new FakeWorker()
    const manager = createManager(worker)
    const events: TaskProgress[] = []
    const unsubscribe = manager.subscribe((progress) => events.push(progress))
    const previewPromise = manager.preview(previewRequest())
    worker.respond(progressMessage('previewing', 0.1))
    worker.respond(progressMessage('awaiting-confirmation', 0.9))
    worker.respond({ schemaVersion: 1, type: 'preview-result', preview: previewResult() })
    await previewPromise

    manager.cancel(TASK_ID)
    expect(worker.messages.at(-1)).toEqual({ schemaVersion: 1, type: 'cancel', taskId: TASK_ID })
    worker.respond(progressMessage('cancelled', 0))
    await vi.waitFor(() => expect(manager.activeCount).toBe(0))

    expect(events.at(-1)?.state).toBe('cancelled')
    expect(worker.killed).toBe(true)
    unsubscribe()
    unsubscribe()
  })

  it('kills and rejects a task that exceeds the operation timeout', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const manager = createManager(worker, { operationTimeoutMs: 25 })
    const previewPromise = manager.preview(previewRequest())
    const rejection = expect(previewPromise).rejects.toMatchObject({
      appError: { code: 'TASK_TIMEOUT' }
    })

    await vi.advanceTimersByTimeAsync(26)

    await rejection
    expect(worker.killed).toBe(true)
    expect(manager.activeCount).toBe(0)
  })

  it('cleans an exact registered temporary workspace after an execution crash', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const worker = new FakeWorker()
    const manager = createManager(worker, {
      cleanupWorkspace: async (workspace) =>
        rm(workspace.rootPath, { recursive: true, force: true })
    })
    const previewPromise = manager.preview(previewRequest(outputDirectory))
    worker.respond(progressMessage('previewing', 0.1))
    worker.respond(progressMessage('awaiting-confirmation', 0.9))
    worker.respond({ schemaVersion: 1, type: 'preview-result', preview: previewResult() })
    await previewPromise
    const rootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    worker.respond(progressMessage('running', 0.2))

    worker.emit('exit', 1)

    await expect(executionPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    await expect(access(rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a workspace created under a replaced output-directory identity', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const worker = new FakeWorker()
    const cleaned: string[] = []
    const manager = createManager(worker, {
      createWorkspace: async () => ({
        rootPath: join(outputDirectory, '.bid-sentry-tmp-test'),
        outputDirectory,
        rootIdentity: TEST_IDENTITY,
        outputDirectoryIdentity: { ...TEST_IDENTITY, inode: '99' }
      }),
      cleanupWorkspace: async (workspace) => {
        cleaned.push(workspace.rootPath)
      }
    })
    await resolvePreview(manager, worker, outputDirectory)

    await expect(manager.execute(executeRequest())).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })

    expect(worker.messages.some((message) => message.type === 'execute')).toBe(false)
    expect(cleaned).toEqual([join(outputDirectory, '.bid-sentry-tmp-test')])
  })

  it('rejects when the input directory is replaced between preview and execution', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const detachedDirectory = `${outputDirectory}-selected`
    temporaryDirectories.push(detachedDirectory)
    const worker = new FakeWorker()
    const manager = new TaskManager(() => worker)
    await resolvePreview(manager, worker, outputDirectory)
    await rename(outputDirectory, detachedDirectory)
    await mkdir(outputDirectory)

    await expect(manager.execute(executeRequest())).rejects.toMatchObject({
      appError: { code: 'FILE_CHANGED' }
    })

    expect(worker.messages.some((message) => message.type === 'execute')).toBe(false)
    expect(
      (await readdir(outputDirectory)).filter((name) => name.startsWith('.bid-sentry-tmp-'))
    ).toEqual([])
  })

  it('rejects instead of publishing completed when final result paths are inconsistent', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const worker = new FakeWorker()
    const manager = createManager(worker)
    const events: TaskProgress[] = []
    manager.subscribe((progress) => events.push(progress))
    await resolvePreview(manager, worker, outputDirectory)
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    const result = await writeExecutionResultFixture({
      taskId: TASK_ID,
      inputSha256: SHA_A,
      inputDisplayName: 'input.docx',
      outputDirectory,
      workspaceRootPath
    })
    const rejection = expect(executionPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    worker.respond(progressMessage('running', 0.2))
    worker.respond(progressMessage('verifying', 0.8))
    worker.respond(progressMessage('completed', 1, result.completionVerification))
    worker.respond({
      schemaVersion: 1,
      type: 'execute-result',
      result: { ...result, outputPaths: ['/outside/input_sanitized.docx'] }
    })

    await rejection
    expect(events.some((event) => event.state === 'completed')).toBe(false)
    expect(events.at(-1)).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR' } })
    await expect(access(result.outputPaths[0] as string)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects without hanging when registered workspace cleanup fails', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const worker = new FakeWorker()
    const manager = createManager(worker, {
      cleanupWorkspace: async () => {
        throw new Error('synthetic cleanup failure')
      }
    })
    const events: TaskProgress[] = []
    manager.subscribe((progress) => events.push(progress))
    await resolvePreview(manager, worker, outputDirectory)
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    const result = await writeExecutionResultFixture({
      taskId: TASK_ID,
      inputSha256: SHA_A,
      inputDisplayName: 'input.docx',
      outputDirectory,
      workspaceRootPath
    })
    const rejection = expect(executionPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    worker.respond(progressMessage('running', 0.2))
    worker.respond(progressMessage('verifying', 0.8))
    worker.respond(progressMessage('completed', 1, result.completionVerification))
    worker.respond({ schemaVersion: 1, type: 'execute-result', result })

    await rejection
    expect(manager.activeCount).toBe(0)
    expect(events.some((event) => event.state === 'completed')).toBe(false)
    expect(events.at(-1)).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR' } })
    await expect(access(result.outputPaths[0] as string)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves rollback failure cause and never deletes a user replacement', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const outputPath = join(outputDirectory, 'input_sanitized.docx')
    const worker = new FakeWorker()
    const manager = createManager(worker, {
      cleanupWorkspace: async () => {
        await unlink(outputPath)
        await writeFile(outputPath, 'user replacement', 'utf8')
        throw new Error('synthetic cleanup failure')
      }
    })
    await resolvePreview(manager, worker, outputDirectory)
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    const result = await writeExecutionResultFixture({
      taskId: TASK_ID,
      inputSha256: SHA_A,
      inputDisplayName: 'input.docx',
      outputDirectory,
      workspaceRootPath
    })

    worker.respond(progressMessage('running', 0.2))
    worker.respond(progressMessage('verifying', 0.8))
    worker.respond(progressMessage('completed', 1, result.completionVerification))
    worker.respond({ schemaVersion: 1, type: 'execute-result', result })

    const failure = await executionPromise.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TaskManagerError)
    expect((failure as Error).cause).toBeInstanceOf(Error)
    expect(await readFile(outputPath, 'utf8')).toBe('user replacement')
    expect(manager.activeCount).toBe(0)
  })

  it('rejects missing published artifacts and rolls back the remaining verified files', async () => {
    const outputDirectory = await createTemporaryDirectory()
    const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
    const worker = new FakeWorker()
    const manager = createManager(worker)
    const events: TaskProgress[] = []
    manager.subscribe((progress) => events.push(progress))
    await resolvePreview(manager, worker, outputDirectory)
    const executionPromise = manager.execute(executeRequest())
    await waitForExecute(worker)
    const result = await writeExecutionResultFixture({
      taskId: TASK_ID,
      inputSha256: SHA_A,
      inputDisplayName: 'input.docx',
      outputDirectory,
      workspaceRootPath
    })
    await unlink(result.outputPaths[0] as string)

    worker.respond(progressMessage('running', 0.2))
    worker.respond(progressMessage('verifying', 0.8))
    worker.respond(progressMessage('completed', 1, result.completionVerification))
    worker.respond({ schemaVersion: 1, type: 'execute-result', result })

    await expect(executionPromise).rejects.toMatchObject({
      appError: { code: 'INTERNAL_ERROR' }
    })
    expect(events.some((event) => event.state === 'completed')).toBe(false)
    await expect(access(result.jsonReportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(result.htmlReportPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('settles forced cancellation as cancelled when the worker does not respond', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const manager = createManager(worker, { cancelKillTimeoutMs: 25 })
    const events: TaskProgress[] = []
    manager.subscribe((progress) => events.push(progress))
    await resolvePreview(manager, worker)

    manager.cancel(TASK_ID)
    await vi.advanceTimersByTimeAsync(26)

    expect(manager.activeCount).toBe(0)
    expect(worker.killed).toBe(true)
    expect(events.at(-1)?.state).toBe('cancelled')
  })

  it('expires an abandoned awaiting-confirmation worker', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const manager = createManager(worker, { operationTimeoutMs: 25 })
    const events: TaskProgress[] = []
    manager.subscribe((progress) => events.push(progress))
    await resolvePreview(manager, worker)

    await vi.advanceTimersByTimeAsync(26)

    expect(manager.activeCount).toBe(0)
    expect(events.at(-1)).toMatchObject({ state: 'failed', error: { code: 'TASK_TIMEOUT' } })
  })

  it('enforces the configured concurrency limit', () => {
    const firstWorker = new FakeWorker()
    const manager = createManager(firstWorker)
    void manager.preview(previewRequest())

    expect(() =>
      manager.preview({
        ...previewRequest(),
        taskId: '323e4567-e89b-42d3-a456-426614174000'
      })
    ).toThrow(TaskManagerError)
  })

  it('shuts down active workers and settles pending calls as cancelled', async () => {
    const worker = new FakeWorker()
    const manager = createManager(worker)
    const previewPromise = manager.preview(previewRequest())
    const rejection = expect(previewPromise).rejects.toMatchObject({
      appError: { code: 'TASK_CANCELLED' }
    })

    await manager.shutdown()

    await rejection
    expect(worker.killed).toBe(true)
    expect(manager.activeCount).toBe(0)
  })
})

class FakeWorker extends EventEmitter implements ManagedWorkerProcess {
  readonly messages: WorkerRequest[] = []
  killed = false
  throwOnPost = false
  throwOnKill = false

  postMessage(message: WorkerRequest): void {
    if (this.throwOnPost) throw new Error('synthetic postMessage failure')
    this.messages.push(message)
  }

  kill(): boolean {
    if (this.throwOnKill) throw new Error('synthetic kill failure')
    this.killed = true
    return true
  }

  respond(message: WorkerResponse): void {
    this.emit('message', message)
  }
}

function previewRequest(inputDirectory = '/safe'): WorkerPreviewRequest {
  return {
    schemaVersion: 1,
    type: 'preview',
    taskId: TASK_ID,
    inputs: [
      {
        inputId: INPUT_ID,
        snapshot: {
          schemaVersion: 1,
          absolutePath: join(inputDirectory, 'input.docx'),
          displayName: 'input.docx',
          documentType: 'docx',
          size: 100,
          sha256: SHA_A,
          mtimeMs: 1
        }
      }
    ]
  }
}

function executeRequest(): TaskExecutionRequest {
  return {
    schemaVersion: 1,
    type: 'execute',
    taskId: TASK_ID,
    planDigest: 'c'.repeat(64),
    outputMode: 'suffix',
    outputSuffix: '_已清洗',
    appVersion: '0.1.0'
  }
}

function createManager(worker: FakeWorker, options: TaskManagerOptions = {}): TaskManager {
  return new TaskManager(() => worker, {
    createWorkspace: async (outputDirectory) => {
      const rootPath = join(outputDirectory, '.bid-sentry-tmp-test')
      await mkdir(rootPath, { recursive: true })
      const [root, output] = await Promise.all([
        resolvePathIdentityWithoutSymbolicLinks(rootPath),
        resolvePathIdentityWithoutSymbolicLinks(outputDirectory)
      ])
      return {
        rootPath: root.canonicalPath,
        outputDirectory: output.canonicalPath,
        rootIdentity: root.identity,
        outputDirectoryIdentity: output.identity
      }
    },
    cleanupWorkspace: async (workspace) => rm(workspace.rootPath, { recursive: true, force: true }),
    ...options
  })
}

async function waitForExecute(worker: FakeWorker): Promise<void> {
  await vi.waitFor(() => expect(worker.messages.at(-1)?.type).toBe('execute'))
}

function previewResult() {
  return {
    schemaVersion: 1 as const,
    taskId: TASK_ID,
    planDigest: 'c'.repeat(64),
    createdAt: '2026-08-09T10:00:00+08:00',
    files: [
      {
        inputId: INPUT_ID,
        displayName: 'input.docx',
        documentType: 'docx' as const,
        size: 100,
        fields: [],
        warnings: [],
        blockers: []
      }
    ]
  }
}

function progressMessage(
  state: TaskProgress['state'],
  progress: number,
  verification?: VerificationReport
): WorkerResponse {
  return {
    schemaVersion: 1,
    type: 'progress',
    progress: {
      schemaVersion: 1,
      taskId: TASK_ID,
      state,
      progress,
      message: `状态：${state}`,
      ...(verification ? { verification } : {})
    }
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-task-manager-'))
  temporaryDirectories.push(directory)
  return directory
}

async function resolvePreview(
  manager: TaskManager,
  worker: FakeWorker,
  inputDirectory = '/safe'
): Promise<void> {
  const previewPromise = manager.preview(previewRequest(inputDirectory))
  worker.respond(progressMessage('previewing', 0.1))
  worker.respond(progressMessage('awaiting-confirmation', 0.9))
  worker.respond({ schemaVersion: 1, type: 'preview-result', preview: previewResult() })
  await previewPromise
}

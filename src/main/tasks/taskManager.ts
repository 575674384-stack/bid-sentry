import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  TaskProgressSchema,
  TaskExecutionRequestSchema,
  FileSystemIdentitySchema,
  TemporaryWorkspaceDescriptorSchema,
  WorkerExecuteRequestSchema,
  WorkerPreviewRequestSchema,
  WorkerResponseSchema,
  createAppError,
  type AppError,
  type FileSystemIdentity,
  type SanitizationPreview,
  type TaskProgress,
  type TaskState,
  type TaskExecutionRequest,
  type TemporaryWorkspaceDescriptor,
  type WorkerExecutionResult,
  type WorkerPreviewRequest,
  type WorkerRequest
} from '../../shared/contracts'
import type { DiagnosticRecorder } from '../diagnostics/diagnosticRecorder'
import {
  DocumentSafetyError,
  cleanupAbandonedTemporaryWorkspace,
  createTemporaryWorkspace,
  normalizeFileIdentity,
  rollbackPublishedFiles,
  type PublishedFile
} from '../../core/documents/fileSafety'
import { sameFileSystemIdentity } from '../../core/documents/pathSafety'
import { aggregateVerification } from '../../core/sanitization/verificationSummary'
import { validateExecutionResultArtifacts } from './validateExecutionResult'

export interface ManagedWorkerProcess {
  postMessage(message: WorkerRequest): void
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  kill(): boolean
}

export type WorkerLauncher = (taskId: string) => ManagedWorkerProcess
export type TaskProgressListener = (progress: TaskProgress) => void

export interface TaskManagerOptions {
  maxConcurrent?: 1 | 2
  operationTimeoutMs?: number
  cancelKillTimeoutMs?: number
  cleanupWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  createWorkspace?: (
    outputDirectory: string,
    expectedOutputDirectoryIdentity: FileSystemIdentity
  ) => Promise<TemporaryWorkspaceDescriptor>
  recordWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  forgetWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  diagnostics?: DiagnosticRecorder
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: TaskManagerError): void
}

interface TaskRecord {
  taskId: string
  worker: ManagedWorkerProcess
  state: TaskState
  preview: Deferred<SanitizationPreview>
  execution: Deferred<WorkerExecutionResult> | null
  expectedOutputDirectory: string | null
  expectedOutputDirectoryIdentity: FileSystemIdentity | null
  workspace: TemporaryWorkspaceDescriptor | null
  operationTimer: NodeJS.Timeout | null
  killTimer: NodeJS.Timeout | null
  pendingCompletion: TaskProgress | null
  cancelRequested: boolean
  intentionalExit: boolean
  settled: boolean
}

const ALLOWED_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = Object.freeze({
  created: ['previewing', 'failed', 'cancelled'],
  previewing: ['previewing', 'awaiting-confirmation', 'failed', 'cancelled'],
  'awaiting-confirmation': ['running', 'failed', 'cancelled'],
  running: ['running', 'verifying', 'failed', 'cancelled'],
  verifying: ['verifying', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
})

export class TaskManagerError extends Error {
  constructor(
    readonly appError: AppError,
    cause?: unknown
  ) {
    super(appError.message, cause === undefined ? undefined : { cause })
    this.name = 'TaskManagerError'
  }
}

export class TaskManager {
  readonly #tasks = new Map<string, TaskRecord>()
  readonly #listeners = new Set<TaskProgressListener>()
  readonly #maxConcurrent: 1 | 2
  readonly #operationTimeoutMs: number
  readonly #cancelKillTimeoutMs: number
  readonly #cleanupWorkspace: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  readonly #createWorkspace: (
    outputDirectory: string,
    expectedOutputDirectoryIdentity: FileSystemIdentity
  ) => Promise<TemporaryWorkspaceDescriptor>
  readonly #recordWorkspace: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  readonly #forgetWorkspace: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  readonly #diagnostics: DiagnosticRecorder | undefined

  constructor(
    private readonly launchWorker: WorkerLauncher,
    options: TaskManagerOptions = {}
  ) {
    this.#maxConcurrent = options.maxConcurrent ?? 1
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 10 * 60 * 1000
    this.#cancelKillTimeoutMs = options.cancelKillTimeoutMs ?? 2_000
    this.#cleanupWorkspace = options.cleanupWorkspace ?? cleanupAbandonedTemporaryWorkspace
    this.#createWorkspace =
      options.createWorkspace ??
      (async (outputDirectory, expectedOutputDirectoryIdentity) => {
        const workspace = await createTemporaryWorkspace(
          outputDirectory,
          expectedOutputDirectoryIdentity
        )
        return {
          rootPath: workspace.rootPath,
          outputDirectory: workspace.outputDirectory,
          rootIdentity: workspace.rootIdentity,
          outputDirectoryIdentity: workspace.outputDirectoryIdentity
        }
      })
    this.#recordWorkspace = options.recordWorkspace ?? (async () => undefined)
    this.#forgetWorkspace = options.forgetWorkspace ?? (async () => undefined)
    this.#diagnostics = options.diagnostics
  }

  get activeCount(): number {
    return this.#tasks.size
  }

  preview(requestInput: WorkerPreviewRequest): Promise<SanitizationPreview> {
    const request = WorkerPreviewRequestSchema.parse(requestInput)
    if (this.#tasks.size >= this.#maxConcurrent || this.#tasks.has(request.taskId)) {
      throw new TaskManagerError(createAppError('INVALID_REQUEST', { retryable: true }))
    }

    const worker = this.launchWorker(request.taskId)
    const record: TaskRecord = {
      taskId: request.taskId,
      worker,
      state: 'created',
      preview: deferred<SanitizationPreview>(),
      execution: null,
      expectedOutputDirectory: null,
      expectedOutputDirectoryIdentity: null,
      workspace: null,
      operationTimer: null,
      killTimer: null,
      pendingCompletion: null,
      cancelRequested: false,
      intentionalExit: false,
      settled: false
    }
    this.#tasks.set(request.taskId, record)
    try {
      worker.on('message', (message) => void this.#handleMessage(record, message))
      worker.on('exit', () => void this.#handleExit(record))
      this.#armOperationTimer(record)
      worker.postMessage(request)
    } catch {
      void this.#fail(record, createAppError('INTERNAL_ERROR')).catch(() => undefined)
    }
    return record.preview.promise
  }

  execute(
    requestInput: TaskExecutionRequest,
    selectedOutputDirectoryIdentity: FileSystemIdentity
  ): Promise<WorkerExecutionResult> {
    const request = TaskExecutionRequestSchema.parse(requestInput)
    const outputDirectoryIdentity = FileSystemIdentitySchema.parse(selectedOutputDirectoryIdentity)
    const record = this.#tasks.get(request.taskId)
    if (!record || record.state !== 'awaiting-confirmation' || record.execution) {
      throw new TaskManagerError(createAppError('TASK_NOT_FOUND'))
    }

    record.execution = deferred<WorkerExecutionResult>()
    record.expectedOutputDirectory = resolve(request.outputDirectory)
    record.expectedOutputDirectoryIdentity = outputDirectoryIdentity
    this.#armOperationTimer(record)
    void this.#prepareExecution(record, request)
    return record.execution.promise
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.#tasks.values()].map((record) =>
        this.#fail(record, createAppError('TASK_CANCELLED')).catch(() => undefined)
      )
    )
  }

  cancel(taskId: string): void {
    const record = this.#tasks.get(taskId)
    if (!record || record.settled) throw new TaskManagerError(createAppError('TASK_NOT_FOUND'))
    record.cancelRequested = true
    if (record.killTimer) clearTimeout(record.killTimer)
    record.killTimer = setTimeout(() => {
      if (!record.settled) {
        void this.#fail(record, createAppError('TASK_CANCELLED')).catch(() => undefined)
      }
    }, this.#cancelKillTimeoutMs)
    try {
      record.worker.postMessage({ schemaVersion: 1, type: 'cancel', taskId })
    } catch {
      void this.#fail(record, createAppError('TASK_CANCELLED')).catch(() => undefined)
    }
  }

  subscribe(listener: TaskProgressListener): () => void {
    this.#listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  async #handleMessage(record: TaskRecord, rawMessage: unknown): Promise<void> {
    if (record.settled) return
    const parsed = WorkerResponseSchema.safeParse(rawMessage)
    if (!parsed.success) {
      await this.#fail(record, createAppError('INTERNAL_ERROR'))
      return
    }

    const message = parsed.data
    const messageTaskId =
      message.type === 'progress'
        ? message.progress.taskId
        : message.type === 'preview-result'
          ? message.preview.taskId
          : message.type === 'execute-result'
            ? message.result.taskId
            : message.taskId
    if (messageTaskId !== record.taskId) {
      await this.#fail(record, createAppError('INTERNAL_ERROR'))
      return
    }

    if (message.type === 'progress') {
      await this.#acceptProgress(record, message.progress)
      return
    }
    if (message.type === 'error') {
      await this.#fail(record, message.error)
      return
    }
    if (message.type === 'preview-result') {
      if (record.state !== 'awaiting-confirmation') {
        await this.#fail(record, createAppError('INTERNAL_ERROR'))
        return
      }
      this.#armOperationTimer(record)
      record.preview.resolve(message.preview)
      return
    }

    const logicalResultValid =
      record.state === 'completed' &&
      Boolean(record.execution) &&
      Boolean(record.pendingCompletion) &&
      this.#executionResultMatches(record, message.result)
    let publishedFiles: PublishedFile[] = []
    if (record.execution && record.workspace) {
      try {
        publishedFiles = await validateExecutionResultArtifacts({
          result: message.result,
          outputDirectory: record.workspace.outputDirectory,
          workspaceRootPath: record.workspace.rootPath,
          logicalResultValid
        })
      } catch (error) {
        await this.#fail(record, createAppError('INTERNAL_ERROR'), undefined, error)
        return
      }
    }
    if (!logicalResultValid || !record.execution || !record.pendingCompletion) {
      await this.#fail(record, createAppError('INTERNAL_ERROR'))
      return
    }
    const execution = record.execution
    const completion = record.pendingCompletion
    const cleanupError = await this.#finish(record)
    if (cleanupError) {
      let rollbackError: unknown
      try {
        await rollbackPublishedFiles(publishedFiles)
      } catch (error) {
        rollbackError = error
      }
      record.state = 'failed'
      this.#emit(failedProgress(record.taskId, cleanupError))
      execution.reject(new TaskManagerError(cleanupError, rollbackError))
      return
    }
    this.#emit(completion)
    execution.resolve(message.result)
  }

  async #acceptProgress(record: TaskRecord, progressInput: TaskProgress): Promise<void> {
    const progress = TaskProgressSchema.parse(progressInput)
    if (!ALLOWED_TRANSITIONS[record.state].includes(progress.state)) {
      await this.#fail(record, createAppError('INTERNAL_ERROR'))
      return
    }
    record.state = progress.state
    if (progress.state === 'completed') {
      record.pendingCompletion = progress
      return
    }
    this.#emit(progress)

    if (progress.state === 'cancelled') {
      await this.#fail(record, createAppError('TASK_CANCELLED'), progress)
    } else if (progress.state === 'failed' && progress.error) {
      await this.#fail(record, progress.error, progress)
    }
  }

  async #handleExit(record: TaskRecord): Promise<void> {
    if (record.intentionalExit || record.settled) return
    await this.#fail(
      record,
      createAppError(record.cancelRequested ? 'TASK_CANCELLED' : 'INTERNAL_ERROR')
    )
  }

  async #prepareExecution(record: TaskRecord, request: TaskExecutionRequest): Promise<void> {
    try {
      const expectedOutput = record.expectedOutputDirectory
      const expectedOutputIdentity = record.expectedOutputDirectoryIdentity
      if (!expectedOutput || !expectedOutputIdentity) {
        await this.#fail(record, createAppError('INTERNAL_ERROR'))
        return
      }
      const workspace = TemporaryWorkspaceDescriptorSchema.parse(
        await this.#createWorkspace(request.outputDirectory, expectedOutputIdentity)
      )
      if (record.settled) {
        await this.#cleanupWorkspace(workspace)
        return
      }
      if (
        normalizeFileIdentity(workspace.outputDirectory) !==
          normalizeFileIdentity(expectedOutput) ||
        !sameFileSystemIdentity(workspace.outputDirectoryIdentity, expectedOutputIdentity) ||
        normalizeFileIdentity(dirname(resolve(workspace.rootPath))) !==
          normalizeFileIdentity(expectedOutput) ||
        !basename(resolve(workspace.rootPath)).startsWith('.bid-sentry-tmp-')
      ) {
        await this.#cleanupWorkspace(workspace).catch(() => undefined)
        await this.#fail(record, createAppError('INTERNAL_ERROR'))
        return
      }
      record.workspace = TemporaryWorkspaceDescriptorSchema.parse({
        ...workspace,
        rootPath: resolve(workspace.rootPath),
        outputDirectory: resolve(workspace.outputDirectory)
      })
      await this.#recordWorkspace(record.workspace)
      if (record.cancelRequested) {
        await this.#fail(record, createAppError('TASK_CANCELLED'))
        return
      }
      record.worker.postMessage(
        WorkerExecuteRequestSchema.parse({
          ...request,
          workspaceRootPath: record.workspace.rootPath,
          workspaceRootIdentity: record.workspace.rootIdentity,
          outputDirectoryIdentity: record.workspace.outputDirectoryIdentity
        })
      )
    } catch (error) {
      await this.#fail(
        record,
        error instanceof DocumentSafetyError ? error.appError : createAppError('INTERNAL_ERROR')
      )
    }
  }

  async #fail(
    record: TaskRecord,
    error: AppError,
    existingProgress?: TaskProgress,
    cause?: unknown
  ): Promise<void> {
    if (record.settled) return
    const safeError = withTaskDiagnostic(error, record.state)
    void this.#diagnostics?.recordError(safeError, {
      taskType: 'sanitization',
      systemCategory: diagnosticCategory(safeError.code)
    })
    record.settled = true
    this.#clearTimers(record)
    if (!existingProgress) {
      record.state = safeError.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed'
      this.#emit(
        TaskProgressSchema.parse({
          schemaVersion: 1,
          taskId: record.taskId,
          state: record.state,
          progress: 0,
          message: safeError.message,
          ...(record.state === 'failed' ? { error: safeError } : {})
        })
      )
    }
    record.intentionalExit = true
    this.#kill(record)
    await this.#cleanup(record)
    const failure = new TaskManagerError(safeError, cause)
    record.preview.reject(failure)
    record.execution?.reject(failure)
  }

  async #finish(record: TaskRecord): Promise<AppError | null> {
    record.settled = true
    this.#clearTimers(record)
    record.intentionalExit = true
    this.#kill(record)
    return this.#cleanup(record)
  }

  async #cleanup(record: TaskRecord): Promise<AppError | null> {
    try {
      if (record.workspace) {
        await this.#cleanupWorkspace(record.workspace)
        await this.#forgetWorkspace(record.workspace)
      }
      return null
    } catch {
      return createAppError('INTERNAL_ERROR')
    } finally {
      this.#tasks.delete(record.taskId)
    }
  }

  #executionResultMatches(record: TaskRecord, result: WorkerExecutionResult): boolean {
    const expectedDirectory = record.expectedOutputDirectory
    const completionVerification = record.pendingCompletion?.verification
    const reportVerification = aggregateVerification(
      result.report.files.map((file) => file.verification)
    )
    if (
      !expectedDirectory ||
      !completionVerification ||
      JSON.stringify(completionVerification) !== JSON.stringify(result.completionVerification) ||
      JSON.stringify(reportVerification) !== JSON.stringify(result.completionVerification) ||
      result.outputPaths.length !== result.report.files.length
    ) {
      return false
    }
    if (
      result.outputPaths.some(
        (outputPath, index) =>
          normalizeFileIdentity(dirname(resolve(outputPath))) !==
            normalizeFileIdentity(expectedDirectory) ||
          basename(outputPath) !== result.report.files[index]?.outputDisplayName
      )
    ) {
      return false
    }
    return [result.jsonReportPath, result.htmlReportPath].every(
      (reportPath) =>
        normalizeFileIdentity(dirname(resolve(reportPath))) ===
        normalizeFileIdentity(expectedDirectory)
    )
  }

  #armOperationTimer(record: TaskRecord): void {
    this.#clearOperationTimer(record)
    record.operationTimer = setTimeout(() => {
      void this.#fail(record, createAppError('TASK_TIMEOUT', { retryable: true }))
    }, this.#operationTimeoutMs)
  }

  #clearOperationTimer(record: TaskRecord): void {
    if (record.operationTimer) clearTimeout(record.operationTimer)
    record.operationTimer = null
  }

  #clearTimers(record: TaskRecord): void {
    this.#clearOperationTimer(record)
    if (record.killTimer) clearTimeout(record.killTimer)
    record.killTimer = null
  }

  #emit(progress: TaskProgress): void {
    for (const listener of this.#listeners) {
      try {
        listener(progress)
      } catch {
        // Observers cannot own or interrupt task settlement.
      }
    }
  }

  #kill(record: TaskRecord): void {
    try {
      record.worker.kill()
    } catch {
      // Cleanup and Deferred settlement must continue even if the host throws.
    }
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((reason: TaskManagerError) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason)
  }
}

function failedProgress(taskId: string, error: AppError): TaskProgress {
  return TaskProgressSchema.parse({
    schemaVersion: 1,
    taskId,
    state: 'failed',
    progress: 0,
    message: error.message,
    error
  })
}

function withTaskDiagnostic(error: AppError, state: TaskState): AppError {
  if (error.code === 'TASK_CANCELLED') return error
  if (error.detailId && error.stage) return error
  const stage =
    error.stage ??
    (state === 'previewing'
      ? 'document-parse'
      : state === 'awaiting-confirmation'
        ? 'workspace-prepare'
        : state === 'running'
          ? 'document-write'
          : state === 'verifying'
            ? 'verify'
            : 'unknown')
  return createAppError(error.code, {
    retryable: error.retryable,
    detailId: error.detailId ?? randomUUID(),
    stage
  })
}

function diagnosticCategory(
  code: AppError['code']
):
  | 'filesystem'
  | 'document'
  | 'validation'
  | 'process'
  | 'network'
  | 'update'
  | 'cleanup'
  | 'configuration'
  | 'unknown' {
  if (code === 'FILE_CHANGED' || code === 'OUTPUT_EXISTS' || code === 'FILE_TOO_LARGE') {
    return 'filesystem'
  }
  if (
    code === 'UNSUPPORTED_TYPE' ||
    code === 'ENCRYPTED_FILE' ||
    code === 'SIGNED_DOCUMENT' ||
    code === 'SIGNED_PDF' ||
    code === 'INVALID_DOCUMENT' ||
    code === 'UNSAFE_ARCHIVE'
  ) {
    return 'document'
  }
  if (code === 'INVALID_REQUEST' || code === 'PLAN_EXPIRED') return 'validation'
  if (code === 'TASK_TIMEOUT' || code === 'INTERNAL_ERROR') return 'process'
  if (code === 'AI_CONFIG_INVALID') return 'configuration'
  if (code === 'AI_CONNECTION_FAILED') return 'network'
  if (code === 'TASK_CANCELLED') return 'cleanup'
  return 'unknown'
}

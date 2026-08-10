import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import {
  AiConnectionTestRequestSchema,
  AiSettingsUpdateSchema,
  EmptyPayloadSchema,
  IPC_CHANNELS,
  IPC_RESPONSE_DATA_SCHEMAS,
  IpcRequestEnvelopeSchema,
  IpcResponseEnvelopeSchema,
  MAX_IPC_EVENT_BYTES,
  MAX_IPC_REQUEST_BYTES,
  MAX_IPC_RESPONSE_BYTES,
  OpenResultFileRequestSchema,
  SanitizationExecuteRequestSchema,
  SanitizationPreviewRequestSchema,
  SanitizationTaskResultSchema,
  TaskCancelRequestSchema,
  UpdateCheckRequestSchema,
  UpdateDownloadRequestSchema,
  UpdateInstallRequestSchema,
  UpdatesOpenReleaseRequestSchema,
  ReviewStartRequestSchema,
  ReviewRunRequestSchema,
  ReviewCancelRequestSchema,
  GenerationPreviewRequestSchema,
  GenerationRequestSchema,
  GenerationCancelRequestSchema,
  createAppError,
  toSafeAppError,
  withDiagnostic,
  type AppError,
  type IpcResponseEnvelope,
  type TaskProgress
} from '../../shared/contracts'
import { createInputSnapshot, DocumentSafetyError } from '../../core/documents/fileSafety'
import { testOpenAiCompatibleConnection } from '../ai/openAiCompatibleClient'
import { normalizeAiBaseUrl, type SettingsService } from '../settings/settingsService'
import { TaskManagerError, type TaskManager } from '../tasks/taskManager'
import { PathRegistry } from './pathRegistry'
import type { UpdateService } from '../updates/updateService'
import type { ReviewTaskManager } from '../tasks/reviewTaskManager'
import type { GenerationTaskManager } from '../tasks/generationTaskManager'

export interface IpcSender {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, message: unknown): void
  once?(event: 'destroyed', listener: () => void): unknown
}

export interface IpcInvokeEvent {
  readonly sender: IpcSender
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcInvokeEvent, request: unknown) => Promise<IpcResponseEnvelope>
  ): void
  removeHandler(channel: string): void
}

export interface RegisterIpcDependencies {
  ipcMain: IpcMainLike
  settingsService: SettingsService
  taskManager: TaskManager
  pathRegistry?: PathRegistry
  appVersion: string
  selectInputPaths(): Promise<readonly string[] | null>
  selectOutputDirectory(): Promise<string | null>
  showResultInFolder(absolutePath: string): void
  onSettingsChanged?(settings: Awaited<ReturnType<SettingsService['getPublicSettings']>>): void
  updateService?: UpdateService
  openReleasePage?(url: string): void
  openDiagnosticsDirectory?(): void
  reviewTaskManager?: ReviewTaskManager
  generationTaskManager?: GenerationTaskManager
}

type PayloadSchema<T> = { parse(value: unknown): T }

export function registerIpc(dependencies: RegisterIpcDependencies): () => void {
  const registry = dependencies.pathRegistry ?? new PathRegistry()
  const taskOwners = new Map<string, number>()
  const reviewTaskOwners = new Map<string, number>()
  const generationTaskOwners = new Map<string, number>()
  const pendingCompletions = new Map<string, TaskProgress>()
  const senders = new Map<number, IpcSender>()
  const registeredChannels: string[] = []

  const disposeOwner = (ownerId: number): void => {
    for (const [taskId, taskOwnerId] of taskOwners) {
      if (taskOwnerId !== ownerId) continue
      try {
        dependencies.taskManager.cancel(taskId)
      } catch {
        // The task may already have reached a terminal state.
      }
      taskOwners.delete(taskId)
      pendingCompletions.delete(taskId)
    }
    for (const [taskId, taskOwnerId] of reviewTaskOwners) {
      if (taskOwnerId !== ownerId) continue
      dependencies.reviewTaskManager?.cancel(taskId)
      reviewTaskOwners.delete(taskId)
    }
    for (const [taskId, taskOwnerId] of generationTaskOwners) {
      if (taskOwnerId !== ownerId) continue
      dependencies.generationTaskManager?.cancel(taskId)
      generationTaskOwners.delete(taskId)
    }
    registry.revokeOwner(ownerId)
    senders.delete(ownerId)
  }

  const rememberSender = (sender: IpcSender): void => {
    if (senders.has(sender.id)) return
    senders.set(sender.id, sender)
    sender.once?.('destroyed', () => disposeOwner(sender.id))
  }

  const register = <T>(
    channel: string,
    requestSchema: PayloadSchema<T>,
    responseSchema: PayloadSchema<unknown>,
    operation: (event: IpcInvokeEvent, payload: T) => Promise<unknown>,
    afterValidated?: (event: IpcInvokeEvent, data: unknown) => void
  ): void => {
    dependencies.ipcMain.handle(channel, async (event, rawRequest) => {
      rememberSender(event.sender)
      const requestId = requestIdFromUnknown(rawRequest)
      try {
        if (serializedSize(rawRequest) > MAX_IPC_REQUEST_BYTES) {
          throw new DocumentSafetyError('INVALID_REQUEST')
        }
        const envelope = IpcRequestEnvelopeSchema.parse(rawRequest)
        const payload = requestSchema.parse(envelope.payload)
        const data = responseSchema.parse(await operation(event, payload))
        const response = IpcResponseEnvelopeSchema.parse({
          schemaVersion: 1,
          requestId: envelope.requestId,
          ok: true,
          data
        })
        if (serializedSize(response) > MAX_IPC_RESPONSE_BYTES) {
          throw new DocumentSafetyError('INTERNAL_ERROR')
        }
        afterValidated?.(event, data)
        return response
      } catch (error) {
        return IpcResponseEnvelopeSchema.parse({
          schemaVersion: 1,
          requestId,
          ok: false,
          error: safeIpcError(error, channel)
        })
      }
    })
    registeredChannels.push(channel)
  }

  register(
    IPC_CHANNELS.settingsGet,
    EmptyPayloadSchema,
    IPC_RESPONSE_DATA_SCHEMAS.settingsGet,
    async () => dependencies.settingsService.getPublicSettings()
  )
  if (dependencies.updateService) {
    register(
      IPC_CHANNELS.updatesGet,
      EmptyPayloadSchema,
      IPC_RESPONSE_DATA_SCHEMAS.updatesGet,
      async () => dependencies.updateService?.status
    )
    register(
      IPC_CHANNELS.updatesCheck,
      UpdateCheckRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.updatesCheck,
      async () => dependencies.updateService?.check()
    )
    register(
      IPC_CHANNELS.updatesDownload,
      UpdateDownloadRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.updatesDownload,
      async () => dependencies.updateService?.download()
    )
    register(
      IPC_CHANNELS.updatesInstall,
      UpdateInstallRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.updatesInstall,
      async () => dependencies.updateService?.install()
    )
    register(
      IPC_CHANNELS.updatesOpenRelease,
      UpdatesOpenReleaseRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.updatesOpenRelease,
      async () => {
        dependencies.openReleasePage?.(dependencies.updateService?.openReleasePage() ?? '')
        return { schemaVersion: 1, accepted: true }
      }
    )
  }
  if (dependencies.reviewTaskManager) {
    register(
      IPC_CHANNELS.reviewStart,
      ReviewStartRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.reviewStart,
      async (event) => {
        const taskId = randomUUID()
        reviewTaskOwners.set(taskId, event.sender.id)
        return { schemaVersion: 1, taskId }
      }
    )
    register(
      IPC_CHANNELS.reviewRun,
      ReviewRunRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.reviewRun,
      async (event, request) => {
        const tender = registry.resolveInputs(event.sender.id, [request.tenderInputId])[0]
        const bid = registry.resolveInputs(event.sender.id, [request.bidInputId])[0]
        if (!tender || !bid) throw new DocumentSafetyError('INVALID_REQUEST')
        const output = registry.resolveOutputDirectory(event.sender.id, request.outputDirectoryId)
        assertTaskOwner(reviewTaskOwners, request.taskId, event.sender.id)
        try {
          const result = await dependencies.reviewTaskManager?.run(
            request,
            tender.snapshot,
            bid.snapshot,
            output.absolutePath,
            output.identity
          )
          if (!result) throw new DocumentSafetyError('INTERNAL_ERROR')
          return registry.registerReviewResult(event.sender.id, output.absolutePath, result)
        } finally {
          if (reviewTaskOwners.get(request.taskId) === event.sender.id) {
            reviewTaskOwners.delete(request.taskId)
          }
        }
      }
    )
    register(
      IPC_CHANNELS.reviewCancel,
      ReviewCancelRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.reviewCancel,
      async (event, request) => {
        assertTaskOwner(reviewTaskOwners, request.taskId, event.sender.id)
        dependencies.reviewTaskManager?.cancel(request.taskId)
        reviewTaskOwners.delete(request.taskId)
        return { schemaVersion: 1, cancelled: true }
      }
    )
  }
  if (dependencies.generationTaskManager) {
    register(
      IPC_CHANNELS.generationPreview,
      GenerationPreviewRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.generationPreview,
      async (event, request) => {
        const input = registry.resolveInputs(event.sender.id, [request.inputId])[0]
        if (!input) throw new DocumentSafetyError('INVALID_REQUEST')
        // Main allocates and claims the preview capability before any file
        // parsing.  A destroyed renderer can therefore cancel an in-flight
        // preview instead of leaving document text owned by a dead sender.
        const previewTaskId = randomUUID()
        generationTaskOwners.set(previewTaskId, event.sender.id)
        try {
          const preview = await dependencies.generationTaskManager?.preview(
            request,
            input.snapshot,
            previewTaskId
          )
          if (!preview) throw new DocumentSafetyError('INTERNAL_ERROR')
          if (event.sender.isDestroyed()) throw new DocumentSafetyError('TASK_CANCELLED')
          if (preview.taskId !== previewTaskId) throw new DocumentSafetyError('INTERNAL_ERROR')
          return preview
        } catch (error) {
          dependencies.generationTaskManager?.cancel(previewTaskId)
          generationTaskOwners.delete(previewTaskId)
          throw error
        }
      }
    )
    register(
      IPC_CHANNELS.generationRun,
      GenerationRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.generationRun,
      async (event, request) => {
        const input = registry.resolveInputs(event.sender.id, [request.inputId])[0]
        if (!input) throw new DocumentSafetyError('INVALID_REQUEST')
        const output = registry.resolveOutputDirectory(event.sender.id, request.outputDirectoryId)
        assertTaskOwner(generationTaskOwners, request.previewTaskId, event.sender.id)
        try {
          const result = await dependencies.generationTaskManager?.run(
            request,
            input.snapshot,
            output.absolutePath,
            output.identity
          )
          if (!result) throw new DocumentSafetyError('INTERNAL_ERROR')
          return registry.registerGenerationResult(event.sender.id, output.absolutePath, result)
        } finally {
          if (!dependencies.generationTaskManager?.hasPreview(request.previewTaskId)) {
            generationTaskOwners.delete(request.previewTaskId)
          }
        }
      }
    )
    register(
      IPC_CHANNELS.generationCancel,
      GenerationCancelRequestSchema,
      IPC_RESPONSE_DATA_SCHEMAS.generationCancel,
      async (event, request) => {
        assertTaskOwner(generationTaskOwners, request.taskId, event.sender.id)
        dependencies.generationTaskManager?.cancel(request.taskId)
        generationTaskOwners.delete(request.taskId)
        return { schemaVersion: 1, cancelled: true }
      }
    )
  }
  register(
    IPC_CHANNELS.settingsSave,
    AiSettingsUpdateSchema,
    IPC_RESPONSE_DATA_SCHEMAS.settingsSave,
    async (_event, update) => {
      const settings = await dependencies.settingsService.save(update)
      dependencies.onSettingsChanged?.(settings)
      return settings
    }
  )
  register(
    IPC_CHANNELS.settingsTestAi,
    AiConnectionTestRequestSchema,
    IPC_RESPONSE_DATA_SCHEMAS.settingsTestAi,
    async (_event, request) => {
      const apiKey =
        request.settings.apiKey?.trim() || (await dependencies.settingsService.getApiKeyForUse())
      if (!apiKey || request.settings.clearApiKey) {
        throw new DocumentSafetyError('AI_CONFIG_INVALID')
      }
      return testOpenAiCompatibleConnection({
        baseUrl: normalizeAiBaseUrl(request.settings.baseUrl),
        apiKey,
        timeoutMs: request.settings.timeoutMs
      })
    }
  )
  register(
    IPC_CHANNELS.filesSelectInputs,
    EmptyPayloadSchema,
    IPC_RESPONSE_DATA_SCHEMAS.filesSelectInputs,
    async (event) => {
      const paths = await dependencies.selectInputPaths()
      if (!paths || paths.length === 0) return { schemaVersion: 1, files: [] }
      if (paths.length > 20) throw new DocumentSafetyError('INVALID_REQUEST')
      const snapshots = await Promise.all(paths.map((filePath) => createInputSnapshot(filePath)))
      return registry.registerInputs(event.sender.id, snapshots)
    }
  )
  register(
    IPC_CHANNELS.filesSelectOutput,
    EmptyPayloadSchema,
    IPC_RESPONSE_DATA_SCHEMAS.filesSelectOutput,
    async (event) => {
      const directory = await dependencies.selectOutputDirectory()
      return directory ? registry.registerOutputDirectory(event.sender.id, directory) : null
    }
  )
  register(
    IPC_CHANNELS.sanitizePreview,
    SanitizationPreviewRequestSchema,
    IPC_RESPONSE_DATA_SCHEMAS.sanitizePreview,
    async (event, request) => {
      const taskId = randomUUID()
      taskOwners.set(taskId, event.sender.id)
      try {
        return await dependencies.taskManager.preview({
          schemaVersion: 1,
          type: 'preview',
          taskId,
          inputs: registry.resolveInputs(event.sender.id, request.inputIds)
        })
      } catch (error) {
        taskOwners.delete(taskId)
        throw error
      }
    }
  )
  register(
    IPC_CHANNELS.sanitizeExecute,
    SanitizationExecuteRequestSchema,
    IPC_RESPONSE_DATA_SCHEMAS.sanitizeExecute,
    async (event, command) => {
      assertTaskOwner(taskOwners, command.taskId, event.sender.id)
      const outputDirectory = registry.resolveOutputDirectory(
        event.sender.id,
        command.outputDirectoryId
      )
      try {
        const result = await dependencies.taskManager.execute(
          {
            schemaVersion: 1,
            type: 'execute',
            taskId: command.taskId,
            planDigest: command.planDigest,
            outputDirectory: outputDirectory.absolutePath,
            appVersion: dependencies.appVersion
          },
          outputDirectory.identity
        )
        return registry.registerTaskResult(event.sender.id, outputDirectory.absolutePath, result)
      } finally {
        taskOwners.delete(command.taskId)
      }
    },
    (event, data) => {
      const taskId = SanitizationTaskResultSchema.parse(data).taskId
      const completion = pendingCompletions.get(taskId)
      if (!completion) throw new DocumentSafetyError('INTERNAL_ERROR')
      pendingCompletions.delete(taskId)
      sendProgress(event.sender, completion)
    }
  )
  register(
    IPC_CHANNELS.taskCancel,
    TaskCancelRequestSchema,
    IPC_RESPONSE_DATA_SCHEMAS.taskCancel,
    async (event, request) => {
      assertTaskOwner(taskOwners, request.taskId, event.sender.id)
      dependencies.taskManager.cancel(request.taskId)
      return { schemaVersion: 1, cancelled: true }
    }
  )
  register(
    IPC_CHANNELS.filesOpenResult,
    OpenResultFileRequestSchema,
    IPC_RESPONSE_DATA_SCHEMAS.filesOpenResult,
    async (event, request) => {
      dependencies.showResultInFolder(registry.resolveResultFile(event.sender.id, request.fileId))
      return { schemaVersion: 1, shown: true }
    }
  )
  register(
    IPC_CHANNELS.diagnosticsOpen,
    EmptyPayloadSchema,
    IPC_RESPONSE_DATA_SCHEMAS.diagnosticsOpen,
    async () => {
      dependencies.openDiagnosticsDirectory?.()
      return { schemaVersion: 1, shown: true }
    }
  )

  const unsubscribe = dependencies.taskManager.subscribe((progress) => {
    const ownerId = taskOwners.get(progress.taskId)
    const sender = ownerId === undefined ? undefined : senders.get(ownerId)
    if (progress.state === 'completed') {
      pendingCompletions.set(progress.taskId, progress)
      return
    }
    if (sender && !sender.isDestroyed()) sendProgress(sender, progress)
    if (progress.state === 'failed' || progress.state === 'cancelled') {
      taskOwners.delete(progress.taskId)
      pendingCompletions.delete(progress.taskId)
    }
  })

  return () => {
    unsubscribe()
    for (const channel of registeredChannels) dependencies.ipcMain.removeHandler(channel)
    for (const ownerId of [...senders.keys()]) disposeOwner(ownerId)
    taskOwners.clear()
    pendingCompletions.clear()
  }
}

function sendProgress(sender: IpcSender, progress: TaskProgress): void {
  if (serializedSize(progress) > MAX_IPC_EVENT_BYTES) {
    // Valid progress is bounded by TaskProgressSchema before publication.
    // Drop an impossible oversized event instead of inventing a conflicting state.
    return
  }
  try {
    sender.send(IPC_CHANNELS.taskSubscribe, progress)
  } catch {
    // The invoke response remains the authoritative completion delivery.
  }
}

function safeIpcError(error: unknown, channel: string): AppError {
  if (error instanceof ZodError) return createAppError('INVALID_REQUEST')
  if (error instanceof DocumentSafetyError || error instanceof TaskManagerError) {
    return withDiagnostic(error.appError, diagnosticStageForChannel(channel))
  }
  return withDiagnostic(toSafeAppError(error), diagnosticStageForChannel(channel))
}

function diagnosticStageForChannel(
  channel: string
):
  | 'input-check'
  | 'workspace-prepare'
  | 'document-parse'
  | 'document-write'
  | 'verify'
  | 'publish'
  | 'cleanup'
  | 'ai-request'
  | 'report-write'
  | 'update'
  | 'unknown' {
  if (channel.includes('updates')) return 'update'
  if (channel.includes('review') && channel.endsWith('run')) return 'publish'
  if (channel.includes('generation')) return 'publish'
  if (channel.includes('files')) return 'input-check'
  if (channel.includes('settings:test-ai')) return 'ai-request'
  return 'unknown'
}

function requestIdFromUnknown(request: unknown): string {
  if (
    typeof request === 'object' &&
    request !== null &&
    'requestId' in request &&
    typeof request.requestId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      request.requestId
    )
  ) {
    return request.requestId
  }
  return randomUUID()
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function assertTaskOwner(
  owners: ReadonlyMap<string, number>,
  taskId: string,
  ownerId: number
): void {
  if (owners.get(taskId) !== ownerId) throw new DocumentSafetyError('INVALID_REQUEST')
}

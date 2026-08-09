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
  createAppError,
  toSafeAppError,
  type AppError,
  type IpcResponseEnvelope,
  type TaskProgress
} from '../../shared/contracts'
import { createInputSnapshot, DocumentSafetyError } from '../../core/documents/fileSafety'
import { testOpenAiCompatibleConnection } from '../ai/openAiCompatibleClient'
import { normalizeAiBaseUrl, type SettingsService } from '../settings/settingsService'
import { TaskManagerError, type TaskManager } from '../tasks/taskManager'
import { PathRegistry } from './pathRegistry'

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
}

type PayloadSchema<T> = { parse(value: unknown): T }

export function registerIpc(dependencies: RegisterIpcDependencies): () => void {
  const registry = dependencies.pathRegistry ?? new PathRegistry()
  const taskOwners = new Map<string, number>()
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
          error: safeIpcError(error)
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
  register(
    IPC_CHANNELS.settingsSave,
    AiSettingsUpdateSchema,
    IPC_RESPONSE_DATA_SCHEMAS.settingsSave,
    async (_event, update) => dependencies.settingsService.save(update)
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

function safeIpcError(error: unknown): AppError {
  if (error instanceof ZodError) return createAppError('INVALID_REQUEST')
  if (error instanceof DocumentSafetyError || error instanceof TaskManagerError) {
    return error.appError
  }
  return toSafeAppError(error)
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

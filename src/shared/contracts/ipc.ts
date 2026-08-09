import { z } from 'zod'
import { AppErrorSchema } from './errors'
import {
  SanitizationCommandSchema,
  SanitizationPreviewSchema,
  SanitizationTaskResultSchema
} from './sanitization'
import { AiConnectionTestResultSchema, AiSettingsSchema, AiSettingsUpdateSchema } from './settings'

export const MAX_IPC_REQUEST_BYTES = 64 * 1024
export const MAX_IPC_RESPONSE_BYTES = 4 * 1024 * 1024
export const MAX_IPC_EVENT_BYTES = 1024 * 1024

export const IPC_CHANNELS = Object.freeze({
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsTestAi: 'settings:test-ai',
  filesSelectInputs: 'files:select-inputs',
  filesSelectOutput: 'files:select-output',
  sanitizePreview: 'sanitize:preview',
  sanitizeExecute: 'sanitize:execute',
  taskCancel: 'task:cancel',
  taskSubscribe: 'task:subscribe',
  filesOpenResult: 'files:open-result'
} as const)

export const EmptyPayloadSchema = z.object({}).strict()

export const SelectedInputFileSchema = z
  .object({
    inputId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(255),
    documentType: z.enum(['docx', 'pdf']),
    size: z.number().int().nonnegative()
  })
  .strict()

export const SelectedInputFilesSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.array(SelectedInputFileSchema).max(20)
  })
  .strict()

export const SelectedOutputDirectorySchema = z
  .object({
    schemaVersion: z.literal(1),
    outputDirectoryId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(255)
  })
  .strict()

export const SanitizationPreviewRequestSchema = z
  .object({
    inputIds: z.array(z.string().uuid()).min(1).max(20)
  })
  .strict()

export const AiConnectionTestRequestSchema = z
  .object({
    settings: AiSettingsUpdateSchema
  })
  .strict()

export const SanitizationExecuteRequestSchema = SanitizationCommandSchema

export const TaskCancelRequestSchema = z
  .object({
    taskId: z.string().uuid()
  })
  .strict()

export const OpenResultFileRequestSchema = z
  .object({
    fileId: z.string().uuid()
  })
  .strict()

export const TaskCancellationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    cancelled: z.literal(true)
  })
  .strict()

export const ResultShownSchema = z
  .object({
    schemaVersion: z.literal(1),
    shown: z.literal(true)
  })
  .strict()

export const IPC_RESPONSE_DATA_SCHEMAS = Object.freeze({
  settingsGet: AiSettingsSchema,
  settingsSave: AiSettingsSchema,
  settingsTestAi: AiConnectionTestResultSchema,
  filesSelectInputs: SelectedInputFilesSchema,
  filesSelectOutput: SelectedOutputDirectorySchema.nullable(),
  sanitizePreview: SanitizationPreviewSchema,
  sanitizeExecute: SanitizationTaskResultSchema,
  taskCancel: TaskCancellationResultSchema,
  filesOpenResult: ResultShownSchema
})

export const IpcRequestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    payload: z.unknown()
  })
  .strict()

export const IpcSuccessEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    ok: z.literal(true),
    data: z.unknown()
  })
  .strict()

export const IpcErrorEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    ok: z.literal(false),
    error: AppErrorSchema
  })
  .strict()

export const IpcResponseEnvelopeSchema = z.discriminatedUnion('ok', [
  IpcSuccessEnvelopeSchema,
  IpcErrorEnvelopeSchema
])

export type IpcRequestEnvelope = z.infer<typeof IpcRequestEnvelopeSchema>
export type IpcResponseEnvelope = z.infer<typeof IpcResponseEnvelopeSchema>
export type SelectedInputFile = z.infer<typeof SelectedInputFileSchema>
export type SelectedInputFiles = z.infer<typeof SelectedInputFilesSchema>
export type SelectedOutputDirectory = z.infer<typeof SelectedOutputDirectorySchema>

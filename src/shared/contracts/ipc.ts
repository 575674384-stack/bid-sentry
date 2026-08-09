import { z } from 'zod'
import { AppErrorSchema } from './errors'

export const IPC_CHANNELS = Object.freeze({
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsTestAi: 'settings:test-ai',
  filesSelectInputs: 'files:select-inputs',
  filesSelectOutput: 'files:select-output',
  sanitizePreview: 'sanitize:preview',
  sanitizeExecute: 'sanitize:execute',
  taskCancel: 'task:cancel',
  taskSubscribe: 'task:subscribe'
} as const)

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

import { z } from 'zod'

export const SETTINGS_SCHEMA_VERSION = 1 as const

export const AiSettingsSchema = z
  .object({
    schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4),
    hasApiKey: z.boolean(),
    secretPersistence: z.enum(['encrypted', 'session'])
  })
  .strict()

export const AiSettingsUpdateSchema = z
  .object({
    schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4),
    apiKey: z.string().trim().min(1).max(8_192).optional(),
    clearApiKey: z.boolean().default(false)
  })
  .strict()
  .refine((value) => !(value.apiKey && value.clearApiKey), {
    message: '不能同时保存并清除 API Key。',
    path: ['clearApiKey']
  })

export type AiSettings = z.infer<typeof AiSettingsSchema>
export type AiSettingsUpdate = z.infer<typeof AiSettingsUpdateSchema>

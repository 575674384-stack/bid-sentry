import { z } from 'zod'

export const APP_SETTINGS_SCHEMA_VERSION = 2 as const

export const AppSettingsSchema = z
  .object({
    schemaVersion: z.literal(APP_SETTINGS_SCHEMA_VERSION),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4),
    closeToTray: z.boolean(),
    checkUpdatesOnStartup: z.boolean()
  })
  .strict()

export type AppSettings = z.infer<typeof AppSettingsSchema>

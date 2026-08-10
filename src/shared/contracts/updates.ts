import { z } from 'zod'

export const UpdateStateSchema = z.enum([
  'idle',
  'checking',
  'not-available',
  'available',
  'downloading',
  'downloaded',
  'manual-only',
  'error'
])

export const UpdateStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    state: UpdateStateSchema,
    currentVersion: z.string().trim().min(1).max(100),
    latestVersion: z.string().trim().min(1).max(100).optional(),
    releaseNotes: z.string().max(20_000).optional(),
    releaseUrl: z.string().url().max(2_048).optional(),
    assetName: z.string().trim().min(1).max(255).optional(),
    downloadedPathId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(500).optional()
  })
  .strict()

export const UpdateCheckRequestSchema = z.object({ schemaVersion: z.literal(1) }).strict()
export const UpdateDownloadRequestSchema = z
  .object({ schemaVersion: z.literal(1), acknowledged: z.literal(true) })
  .strict()
export const UpdateInstallRequestSchema = z
  .object({ schemaVersion: z.literal(1), acknowledged: z.literal(true) })
  .strict()

export const UpdateActionResultSchema = z
  .object({ schemaVersion: z.literal(1), accepted: z.literal(true) })
  .strict()

export type UpdateState = z.infer<typeof UpdateStateSchema>
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>

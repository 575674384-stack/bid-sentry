import { z } from 'zod'

/** Stages are deliberately finite so a diagnostic can never contain an
 * exception message, stack, path or document value by accident. */
export const DiagnosticStageSchema = z.enum([
  'input-check',
  'workspace-prepare',
  'document-parse',
  'document-write',
  'verify',
  'publish',
  'cleanup',
  'ai-request',
  'report-write',
  'update',
  'unknown'
])

export const DiagnosticSystemCategorySchema = z.enum([
  'filesystem',
  'document',
  'validation',
  'process',
  'network',
  'update',
  'cleanup',
  'configuration',
  'unknown'
])

export const DiagnosticTaskTypeSchema = z.enum([
  'sanitization',
  'review',
  'generation',
  'application',
  'update',
  'unknown'
])

export const DiagnosticEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    timestamp: z.string().datetime({ offset: true }),
    appVersion: z.string().trim().min(1).max(100),
    runtime: z.string().trim().min(1).max(100),
    os: z.string().trim().min(1).max(100),
    taskType: DiagnosticTaskTypeSchema,
    stage: DiagnosticStageSchema,
    code: z.string().trim().min(1).max(100),
    detailId: z.string().uuid(),
    systemCategory: DiagnosticSystemCategorySchema
  })
  .strict()

export type DiagnosticStage = z.infer<typeof DiagnosticStageSchema>
export type DiagnosticSystemCategory = z.infer<typeof DiagnosticSystemCategorySchema>
export type DiagnosticTaskType = z.infer<typeof DiagnosticTaskTypeSchema>
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>

export const DiagnosticSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    detailId: z.string().uuid(),
    events: z.array(DiagnosticEventSchema).max(100)
  })
  .strict()

export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>

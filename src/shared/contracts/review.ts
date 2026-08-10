import { z } from 'zod'

export const ReviewFindingTypeSchema = z.enum([
  'multiple-bidder-names',
  'role-confusion',
  'project-mismatch',
  'fixed-parameter-mismatch',
  'internal-conflict',
  'missing-response',
  'template-placeholder',
  'ai-suggestion'
])
export const ReviewSeveritySchema = z.enum(['error', 'warning', 'needs-review', 'info'])
export const ReviewSourceSchema = z.enum(['deterministic', 'ai'])
export const ReviewStatusSchema = z.enum(['open', 'dismissed', 'confirmed'])

export const ReviewAnchorSchema = z
  .object({
    document: z.enum(['tender', 'bid']),
    nodeId: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(300),
    excerpt: z.string().trim().min(1).max(1_000)
  })
  .strict()

export const ReviewFindingSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16,64}$/u),
    type: ReviewFindingTypeSchema,
    severity: ReviewSeveritySchema,
    confidence: z.number().min(0).max(1),
    summary: z.string().trim().min(1).max(500),
    tenderEvidence: z.array(ReviewAnchorSchema).max(10),
    bidEvidence: z.array(ReviewAnchorSchema).max(10),
    suggestion: z.string().trim().max(500),
    source: ReviewSourceSchema,
    status: ReviewStatusSchema
  })
  .strict()
  .superRefine((finding, context) => {
    if (
      finding.severity === 'error' &&
      (!finding.tenderEvidence.length || !finding.bidEvidence.length)
    ) {
      context.addIssue({ code: 'custom', message: '确定性错误必须同时具备招标和投标证据。' })
    }
  })

export const ReviewRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    tenderInputId: z.string().uuid(),
    bidInputId: z.string().uuid(),
    bidderName: z.string().trim().min(1).max(300),
    aiConfirmed: z.boolean()
  })
  .strict()

export const ReviewReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    tenderName: z.string().trim().min(1).max(255),
    bidName: z.string().trim().min(1).max(255),
    tenderSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    bidSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    findings: z.array(ReviewFindingSchema).max(5_000),
    deterministicCount: z.number().int().nonnegative(),
    aiCount: z.number().int().nonnegative(),
    status: z.enum(['completed', 'cancelled', 'failed']),
    generatedAt: z.string().datetime({ offset: true })
  })
  .strict()

export const ReviewResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    report: ReviewReportSchema,
    jsonReport: z.string().trim().min(1).max(255),
    htmlReport: z.string().trim().min(1).max(255),
    files: z
      .array(
        z
          .object({
            fileId: z.string().uuid(),
            displayName: z.string().trim().min(1).max(255),
            kind: z.enum(['json-report', 'html-report'])
          })
          .strict()
      )
      .max(2)
      .default([])
  })
  .strict()

export type ReviewAnchor = z.infer<typeof ReviewAnchorSchema>
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
export type ReviewResult = z.infer<typeof ReviewResultSchema>

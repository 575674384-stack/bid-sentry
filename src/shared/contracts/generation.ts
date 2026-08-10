import { z } from 'zod'

export const TemplateCandidateSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    title: z.string().trim().min(1).max(300),
    startNodeId: z.string().trim().min(1).max(200),
    endNodeId: z.string().trim().min(1).max(200),
    startPage: z.number().int().positive().optional(),
    endPage: z.number().int().positive().optional(),
    previewText: z.string().trim().max(1_000).optional(),
    sourceType: z.enum(['docx-template', 'pdf-rebuilt']),
    sectionOutline: z.array(z.string().trim().max(200)).max(100),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().trim().max(300)).max(20)
  })
  .strict()

/** An extra form field proposed by the analysis step or added by the user. */
export const GenerationExtraFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/u),
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().max(500)
  })
  .strict()

export const GenerationUserFormSchema = z
  .object({
    bidderName: z.string().trim().min(1).max(300),
    unifiedSocialCreditCode: z.string().trim().max(100),
    address: z.string().trim().max(500),
    legalRepresentative: z.string().trim().max(100),
    authorizedRepresentative: z.string().trim().max(100),
    contact: z.string().trim().max(100),
    phone: z.string().trim().max(100),
    email: z.string().trim().max(200),
    projectName: z.string().trim().max(300),
    sectionName: z.string().trim().max(200),
    compilationDate: z.string().trim().max(40),
    extraFields: z.array(GenerationExtraFieldSchema).max(30).default([])
  })
  .strict()

/** A field the analysis believes the template expects the bidder to fill. */
export const SuggestedFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/u),
    label: z.string().trim().min(1).max(100),
    hint: z.string().trim().max(200).optional(),
    required: z.boolean()
  })
  .strict()

/**
 * Analysis extraction. The AI (or local fallback) may only shape which
 * questions the user is asked and summarize qualification requirements;
 * deterministic code with tender evidence still owns every filled value.
 */
export const GenerationExtractionSchema = z
  .object({
    aiUsed: z.boolean(),
    qualificationSummary: z.array(z.string().trim().min(1).max(300)).max(12),
    suggestedFields: z.array(SuggestedFieldSchema).max(30),
    notices: z.array(z.string().trim().max(300)).max(10)
  })
  .strict()

export const FieldActionSchema = z
  .object({
    fieldId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    label: z.string().trim().min(1).max(300),
    targetNodeId: z.string().trim().min(1).max(200),
    action: z.enum(['replace', 'placeholder', 'preserve', 'unknown']),
    source: z.enum(['tender-fixed', 'user-form', 'placeholder', 'unknown']),
    value: z.string().max(1_000).optional(),
    placeholderType: z.enum(['image', 'certificate', 'signature', 'stamp', 'text']).optional(),
    evidenceNodeId: z.string().trim().max(200).optional()
  })
  .strict()
  .superRefine((action, context) => {
    if (action.source === 'tender-fixed' && !action.evidenceNodeId)
      context.addIssue({ code: 'custom', message: '固定值必须有招标证据。' })
    if (action.source === 'user-form' && !action.value)
      context.addIssue({ code: 'custom', message: '表单值不能为空。' })
    if (action.source === 'placeholder' && !action.placeholderType)
      context.addIssue({ code: 'custom', message: '占位符必须声明类型。' })
    if (action.source === 'unknown' && action.value)
      context.addIssue({ code: 'custom', message: '未知项不能携带猜测值。' })
  })

export const FillPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    userForm: GenerationUserFormSchema,
    actions: z.array(FieldActionSchema).max(2_000),
    unknownRequired: z.number().int().nonnegative(),
    unknownFields: z
      .array(
        z
          .object({ nodeId: z.string().trim().min(1).max(200), text: z.string().trim().max(500) })
          .strict()
      )
      .max(100),
    unresolvedFields: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(300)
          })
          .strict()
      )
      .max(100)
      .default([]),
    warnings: z.array(z.string().trim().max(500)).max(100)
  })
  .strict()

export const GenerationPlanSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    planId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    actions: z.array(FieldActionSchema).max(2_000),
    unknownRequired: z.number().int().nonnegative(),
    unknownFields: z
      .array(
        z
          .object({ nodeId: z.string().trim().min(1).max(200), text: z.string().trim().max(500) })
          .strict()
      )
      .max(100),
    unresolvedFields: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(300)
          })
          .strict()
      )
      .max(100)
      .default([]),
    warnings: z.array(z.string().trim().max(500)).max(100)
  })
  .strict()

export const GenerationAnalyzeRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputId: z.string().uuid()
  })
  .strict()

export const GenerationPlanRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    analysisTaskId: z.string().uuid(),
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    userForm: GenerationUserFormSchema
  })
  .strict()

export const GenerationRunRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputId: z.string().uuid(),
    analysisTaskId: z.string().uuid(),
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    planId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    confirmed: z.literal(true)
  })
  .strict()

export const GenerationAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    inputName: z.string().trim().min(1).max(255),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    candidates: z.array(TemplateCandidateSchema).min(1).max(50),
    extraction: GenerationExtractionSchema
  })
  .strict()

export const GenerationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    outputName: z.string().trim().min(1).max(255),
    reportName: z.string().trim().min(1).max(255),
    warnings: z.array(z.string().trim().max(500)).max(100),
    files: z
      .array(
        z
          .object({
            fileId: z.string().uuid(),
            displayName: z.string().trim().min(1).max(255),
            kind: z.enum(['generated-document', 'json-report'])
          })
          .strict()
      )
      .max(2)
      .default([])
  })
  .strict()

export type TemplateCandidate = z.infer<typeof TemplateCandidateSchema>
export type GenerationExtraField = z.infer<typeof GenerationExtraFieldSchema>
export type GenerationUserForm = z.infer<typeof GenerationUserFormSchema>
export type SuggestedField = z.infer<typeof SuggestedFieldSchema>
export type GenerationExtraction = z.infer<typeof GenerationExtractionSchema>
export type FieldAction = z.infer<typeof FieldActionSchema>
export type FillPlan = z.infer<typeof FillPlanSchema>
export type GenerationPlan = z.infer<typeof GenerationPlanSchema>
export type GenerationAnalyzeRequest = z.infer<typeof GenerationAnalyzeRequestSchema>
export type GenerationPlanRequest = z.infer<typeof GenerationPlanRequestSchema>
export type GenerationRunRequest = z.infer<typeof GenerationRunRequestSchema>
export type GenerationAnalysis = z.infer<typeof GenerationAnalysisSchema>
export type GenerationResult = z.infer<typeof GenerationResultSchema>

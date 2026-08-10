import { z } from 'zod'

export const TemplateCandidateSchema = z
  .object({
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    title: z.string().trim().min(1).max(300),
    startNodeId: z.string().trim().min(1).max(200),
    endNodeId: z.string().trim().min(1).max(200),
    sourceType: z.enum(['docx-template', 'pdf-rebuilt']),
    sectionOutline: z.array(z.string().trim().max(200)).max(100),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().trim().max(300)).max(20)
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
    compilationDate: z.string().trim().max(40)
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
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    userForm: GenerationUserFormSchema,
    actions: z.array(FieldActionSchema).max(2_000),
    unknownRequired: z.number().int().nonnegative(),
    warnings: z.array(z.string().trim().max(500)).max(100)
  })
  .strict()

export const GenerationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputId: z.string().uuid(),
    outputDirectoryId: z.string().uuid(),
    candidateId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    userForm: GenerationUserFormSchema,
    confirmed: z.literal(true)
  })
  .strict()

export const GenerationPreviewRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputId: z.string().uuid(),
    userForm: GenerationUserFormSchema
  })
  .strict()

export const GenerationPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    inputName: z.string().trim().min(1).max(255),
    candidates: z.array(TemplateCandidateSchema).min(1).max(50),
    actions: z.array(FieldActionSchema).max(2_000),
    warnings: z.array(z.string().trim().max(500)).max(100)
  })
  .strict()

export const GenerationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    outputName: z.string().trim().min(1).max(255),
    reportName: z.string().trim().min(1).max(255),
    warnings: z.array(z.string().trim().max(500)).max(100)
  })
  .strict()

export type TemplateCandidate = z.infer<typeof TemplateCandidateSchema>
export type GenerationUserForm = z.infer<typeof GenerationUserFormSchema>
export type FieldAction = z.infer<typeof FieldActionSchema>
export type FillPlan = z.infer<typeof FillPlanSchema>
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>
export type GenerationPreviewRequest = z.infer<typeof GenerationPreviewRequestSchema>
export type GenerationPreview = z.infer<typeof GenerationPreviewSchema>
export type GenerationResult = z.infer<typeof GenerationResultSchema>

import { z } from 'zod'
import {
  DocumentTypeSchema,
  MetadataFieldCategorySchema,
  MetadataFieldDescriptorSchema,
  ReportFileIdentitySchema
} from './documents'
import { AppErrorSchema } from './errors'

// Keep enough room for the IPC envelope and request ID inside the 4 MiB
// Renderer response ceiling. The same schema is used for a pre-publication
// check in the Worker, so an oversized successful result never reaches disk.
export const MAX_SANITIZATION_RENDERER_DATA_BYTES = 4 * 1024 * 1024 - 4 * 1024
export const MAX_TASK_PROGRESS_BYTES = 1024 * 1024 - 4 * 1024

export const TaskStateSchema = z.enum([
  'created',
  'previewing',
  'awaiting-confirmation',
  'running',
  'verifying',
  'completed',
  'failed',
  'cancelled'
])

export const VerificationCheckSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    status: z.enum(['passed', 'failed']),
    message: z.string().trim().min(1).max(500)
  })
  .strict()

export const VerificationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(['passed', 'failed']),
    checks: z.array(VerificationCheckSchema).min(1).max(10_000),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((report, context) => {
    const failedChecks = report.checks.filter((check) => check.status === 'failed')
    if (report.status === 'passed' && failedChecks.length > 0) {
      context.addIssue({
        code: 'custom',
        message: '验证状态通过时不能包含失败检查。',
        path: ['checks']
      })
    }
    if (report.status === 'failed' && failedChecks.length === 0) {
      context.addIssue({
        code: 'custom',
        message: '验证状态失败时必须包含失败检查。',
        path: ['checks']
      })
    }
  })

export const SanitizationPreviewFileSchema = z
  .object({
    inputId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(255),
    documentType: DocumentTypeSchema,
    size: z.number().int().nonnegative(),
    fields: z.array(MetadataFieldDescriptorSchema).max(10_000),
    warnings: z.array(z.string().trim().min(1).max(500)).max(1_000),
    blockers: z.array(AppErrorSchema).max(100)
  })
  .strict()

export const SanitizationPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime({ offset: true }),
    files: z.array(SanitizationPreviewFileSchema).min(1).max(20)
  })
  .strict()
  .superRefine((preview, context) => {
    if (serializedSize(preview) > MAX_SANITIZATION_RENDERER_DATA_BYTES) {
      context.addIssue({
        code: 'custom',
        message: '清洗预览超过安全响应大小限制。'
      })
    }
  })

export const SanitizationCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    outputDirectoryId: z.string().uuid(),
    acknowledged: z.literal(true)
  })
  .strict()

export const TaskProgressSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    state: TaskStateSchema,
    progress: z.number().min(0).max(1),
    message: z.string().trim().min(1).max(500),
    verification: VerificationReportSchema.optional(),
    error: AppErrorSchema.optional()
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.state === 'completed' && progress.verification?.status !== 'passed') {
      context.addIssue({
        code: 'custom',
        message: '任务只有在验证通过后才能完成。',
        path: ['verification']
      })
    }
    if (progress.state === 'completed' && progress.progress !== 1) {
      context.addIssue({
        code: 'custom',
        message: '完成任务的进度必须为 1。',
        path: ['progress']
      })
    }
    if (progress.state === 'failed' && !progress.error) {
      context.addIssue({
        code: 'custom',
        message: '失败任务必须包含安全错误。',
        path: ['error']
      })
    }
    if (progress.state !== 'failed' && progress.error) {
      context.addIssue({
        code: 'custom',
        message: '只有失败任务可以包含错误。',
        path: ['error']
      })
    }
    if (serializedSize(progress) > MAX_TASK_PROGRESS_BYTES) {
      context.addIssue({
        code: 'custom',
        message: '任务进度超过安全事件大小限制。'
      })
    }
  })

export const SanitizedFieldResultSchema = z
  .object({
    field: z.string().trim().min(1).max(200),
    category: MetadataFieldCategorySchema,
    occurrences: z.number().int().positive(),
    status: z.enum(['changed', 'preserved', 'warning'])
  })
  .strict()

export const SanitizationFileResultSchema = z
  .object({
    input: ReportFileIdentitySchema,
    output: ReportFileIdentitySchema,
    outputDisplayName: z.string().trim().min(1).max(255),
    fields: z.array(SanitizedFieldResultSchema).max(10_000),
    warnings: z.array(z.string().trim().min(1).max(500)).max(1_000),
    verification: VerificationReportSchema
  })
  .strict()
  .superRefine((file, context) => {
    if (
      file.input.sha256 !== file.verification.inputSha256 ||
      file.output.sha256 !== file.verification.outputSha256 ||
      file.input.documentType !== file.output.documentType ||
      file.output.displayName !== file.outputDisplayName
    ) {
      context.addIssue({
        code: 'custom',
        message: '文件身份、输出名称与验证哈希必须一致。'
      })
    }
  })

export const SanitizationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    appVersion: z.string().trim().min(1).max(100),
    taskId: z.string().uuid(),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    status: z.enum(['completed', 'failed', 'cancelled']),
    files: z.array(SanitizationFileResultSchema).max(20),
    warnings: z.array(z.string().trim().min(1).max(500)).max(1_000)
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.status === 'completed' &&
      report.files.some((file) => file.verification.status !== 'passed')
    ) {
      context.addIssue({
        code: 'custom',
        message: '完成报告中的全部文件都必须验证通过。',
        path: ['files']
      })
    }
    if (report.status === 'completed' && report.files.length === 0) {
      context.addIssue({
        code: 'custom',
        message: '完成报告必须包含至少一个文件结果。',
        path: ['files']
      })
    }
    if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
      context.addIssue({
        code: 'custom',
        message: '完成时间不能早于开始时间。',
        path: ['completedAt']
      })
    }
  })

export const SanitizationResultFileSchema = z
  .object({
    fileId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(255),
    kind: z.enum(['sanitized-document', 'json-report', 'html-report'])
  })
  .strict()

export const SanitizationTaskResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    report: SanitizationReportSchema,
    files: z.array(SanitizationResultFileSchema).min(3).max(22)
  })
  .strict()
  .superRefine((result, context) => {
    if (result.report.taskId !== result.taskId || result.report.status !== 'completed') {
      context.addIssue({
        code: 'custom',
        message: '任务结果必须关联同一已完成报告。',
        path: ['report']
      })
    }

    const documentCount = result.files.filter((file) => file.kind === 'sanitized-document').length
    const jsonCount = result.files.filter((file) => file.kind === 'json-report').length
    const htmlCount = result.files.filter((file) => file.kind === 'html-report').length
    if (
      documentCount !== result.report.files.length ||
      jsonCount !== 1 ||
      htmlCount !== 1 ||
      new Set(result.files.map((file) => file.fileId)).size !== result.files.length
    ) {
      context.addIssue({
        code: 'custom',
        message: '任务结果文件清单与报告不一致。',
        path: ['files']
      })
    }
    if (serializedSize(result) > MAX_SANITIZATION_RENDERER_DATA_BYTES) {
      context.addIssue({
        code: 'custom',
        message: '清洗结果超过安全响应大小限制。'
      })
    }
  })

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export type TaskState = z.infer<typeof TaskStateSchema>
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>
export type VerificationReport = z.infer<typeof VerificationReportSchema>
export type SanitizationPreview = z.infer<typeof SanitizationPreviewSchema>
export type SanitizationCommand = z.infer<typeof SanitizationCommandSchema>
export type TaskProgress = z.infer<typeof TaskProgressSchema>
export type SanitizationFileResult = z.infer<typeof SanitizationFileResultSchema>
export type SanitizationReport = z.infer<typeof SanitizationReportSchema>
export type SanitizationResultFile = z.infer<typeof SanitizationResultFileSchema>
export type SanitizationTaskResult = z.infer<typeof SanitizationTaskResultSchema>

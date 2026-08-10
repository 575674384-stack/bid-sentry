import { z } from 'zod'
import { FileSystemIdentitySchema, InputSnapshotSchema } from './documents'
import { OutputModeSchema, OutputSuffixSchema } from './appSettings'
import { AppErrorSchema } from './errors'
import {
  SanitizationPreviewSchema,
  SanitizationReportSchema,
  TaskProgressSchema,
  VerificationReportSchema
} from './sanitization'

export const WorkerPreviewRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('preview'),
    taskId: z.string().uuid(),
    inputs: z
      .array(
        z
          .object({
            inputId: z.string().uuid(),
            snapshot: InputSnapshotSchema
          })
          .strict()
      )
      .min(1)
      .max(20)
  })
  .strict()

export const WorkerExecuteRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('execute'),
    taskId: z.string().uuid(),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    // Outputs are always published next to their own input file. `suffix`
    // appends OutputSuffixSchema to the input base name; `overwrite`
    // atomically replaces the input only after verification passed.
    outputMode: OutputModeSchema,
    outputSuffix: OutputSuffixSchema,
    workspaceRootPath: z.string().min(1),
    workspaceRootIdentity: FileSystemIdentitySchema,
    appVersion: z.string().trim().min(1).max(100)
  })
  .strict()

export const TaskExecutionRequestSchema = WorkerExecuteRequestSchema.omit({
  workspaceRootPath: true,
  workspaceRootIdentity: true
})

export const WorkerCancelRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('cancel'),
    taskId: z.string().uuid()
  })
  .strict()

export const WorkerRequestSchema = z.discriminatedUnion('type', [
  WorkerPreviewRequestSchema,
  WorkerExecuteRequestSchema,
  WorkerCancelRequestSchema
])

export const WorkerExecutionResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().uuid(),
    report: SanitizationReportSchema,
    completionVerification: VerificationReportSchema,
    outputPaths: z.array(z.string().min(1)).min(1),
    jsonReportPath: z.string().min(1),
    htmlReportPath: z.string().min(1)
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.report.taskId !== result.taskId ||
      result.report.status !== 'completed' ||
      result.completionVerification.status !== 'passed' ||
      result.outputPaths.length !== result.report.files.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Worker 完成结果与验证报告不一致。'
      })
    }
  })

export const WorkerProgressMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('progress'),
    progress: TaskProgressSchema
  })
  .strict()

export const WorkerPreviewResultMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('preview-result'),
    preview: SanitizationPreviewSchema
  })
  .strict()

export const WorkerExecutionResultMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('execute-result'),
    result: WorkerExecutionResultSchema
  })
  .strict()

export const WorkerErrorMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('error'),
    taskId: z.string().uuid(),
    error: AppErrorSchema
  })
  .strict()

export const WorkerResponseSchema = z.discriminatedUnion('type', [
  WorkerProgressMessageSchema,
  WorkerPreviewResultMessageSchema,
  WorkerExecutionResultMessageSchema,
  WorkerErrorMessageSchema
])

export type WorkerPreviewRequest = z.infer<typeof WorkerPreviewRequestSchema>
export type WorkerExecuteRequest = z.infer<typeof WorkerExecuteRequestSchema>
export type TaskExecutionRequest = z.infer<typeof TaskExecutionRequestSchema>
export type WorkerCancelRequest = z.infer<typeof WorkerCancelRequestSchema>
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>
export type WorkerExecutionResult = z.infer<typeof WorkerExecutionResultSchema>
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>

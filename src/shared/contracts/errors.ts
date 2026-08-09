import { z } from 'zod'

export const AppErrorCodeSchema = z.enum([
  'UNSUPPORTED_TYPE',
  'FILE_TOO_LARGE',
  'FILE_CHANGED',
  'ENCRYPTED_FILE',
  'SIGNED_DOCUMENT',
  'SIGNED_PDF',
  'INVALID_DOCUMENT',
  'UNSAFE_ARCHIVE',
  'OUTPUT_EXISTS',
  'AI_CONFIG_INVALID',
  'AI_CONNECTION_FAILED',
  'TASK_CANCELLED',
  'INTERNAL_ERROR'
])

export const AppErrorSchema = z
  .object({
    schemaVersion: z.literal(1),
    code: AppErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    detailId: z.string().uuid().optional()
  })
  .strict()

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>
export type AppError = z.infer<typeof AppErrorSchema>

const SAFE_MESSAGES: Readonly<Record<AppErrorCode, string>> = Object.freeze({
  UNSUPPORTED_TYPE: '该文件类型暂不受支持。',
  FILE_TOO_LARGE: '文件超过当前允许的大小限制。',
  FILE_CHANGED: '处理期间文件发生变化，请重新选择。',
  ENCRYPTED_FILE: '加密文件不能进行安全处理。',
  SIGNED_DOCUMENT: '检测到文档数字签名，为避免签名失效已停止处理。',
  SIGNED_PDF: '检测到 PDF 数字签名，为避免签名失效已停止处理。',
  INVALID_DOCUMENT: '文件结构无效或已损坏。',
  UNSAFE_ARCHIVE: 'DOCX 压缩包包含不安全结构。',
  OUTPUT_EXISTS: '输出文件已存在，请选择其他位置或名称。',
  AI_CONFIG_INVALID: 'AI 接口配置无效。',
  AI_CONNECTION_FAILED: '无法连接到 AI 接口。',
  TASK_CANCELLED: '任务已取消。',
  INTERNAL_ERROR: '发生内部错误，任务已安全停止。'
})

export function createAppError(
  code: AppErrorCode,
  options: { retryable?: boolean; detailId?: string } = {}
): AppError {
  return AppErrorSchema.parse({
    schemaVersion: 1,
    code,
    message: SAFE_MESSAGES[code],
    retryable: options.retryable ?? false,
    ...(options.detailId ? { detailId: options.detailId } : {})
  })
}

export function toSafeAppError(error: unknown): AppError {
  const knownError = AppErrorSchema.safeParse(error)
  return knownError.success
    ? createAppError(knownError.data.code, {
        retryable: knownError.data.retryable,
        ...(knownError.data.detailId ? { detailId: knownError.data.detailId } : {})
      })
    : createAppError('INTERNAL_ERROR')
}

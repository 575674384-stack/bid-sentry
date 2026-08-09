import { describe, expect, it } from 'vitest'
import {
  AiSettingsSchema,
  AiSettingsUpdateSchema,
  AppErrorSchema,
  IpcRequestEnvelopeSchema,
  SanitizationReportSchema,
  SanitizationTaskResultSchema,
  TaskProgressSchema,
  VerificationReportSchema,
  WorkerRequestSchema,
  WorkerResponseSchema,
  createAppError,
  toSafeAppError
} from '../../src/shared/contracts'

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function passedVerification(): unknown {
  return {
    schemaVersion: 1,
    status: 'passed',
    checks: [{ name: 'content', status: 'passed', message: '内容指纹一致。' }],
    inputSha256: SHA_A,
    outputSha256: SHA_B
  }
}

describe('AI settings contracts', () => {
  it('accepts public settings without returning a plaintext key', () => {
    const settings = AiSettingsSchema.parse({
      schemaVersion: 1,
      baseUrl: 'https://api.example.com/v1',
      model: 'example-model',
      timeoutMs: 15_000,
      maxConcurrency: 1,
      hasApiKey: true,
      secretPersistence: 'encrypted'
    })

    expect(settings.hasApiKey).toBe(true)
    expect('apiKey' in settings).toBe(false)
    expect(() => AiSettingsSchema.parse({ ...settings, apiKey: 'secret' })).toThrow()
  })

  it('allows a key only on the one-way update contract', () => {
    const update = AiSettingsUpdateSchema.parse({
      schemaVersion: 1,
      baseUrl: 'https://api.example.com/v1',
      model: 'example-model',
      timeoutMs: 15_000,
      maxConcurrency: 2,
      apiKey: 'temporary-input'
    })

    expect(update.apiKey).toBe('temporary-input')
    expect(() => AiSettingsUpdateSchema.parse({ ...update, clearApiKey: true })).toThrow()
  })
})

describe('task completion invariants', () => {
  it('requires a passed verification before a task can complete', () => {
    const base = {
      schemaVersion: 1,
      taskId: TASK_ID,
      state: 'completed',
      progress: 1,
      message: '处理完成。'
    }

    expect(TaskProgressSchema.safeParse(base).success).toBe(false)
    expect(
      TaskProgressSchema.safeParse({
        ...base,
        verification: {
          schemaVersion: 1,
          status: 'failed',
          checks: [{ name: 'content', status: 'failed', message: '内容不一致。' }],
          inputSha256: SHA_A,
          outputSha256: SHA_B
        }
      }).success
    ).toBe(false)
    expect(
      TaskProgressSchema.safeParse({ ...base, verification: passedVerification() }).success
    ).toBe(true)
    expect(
      TaskProgressSchema.safeParse({
        ...base,
        progress: 0.99,
        verification: passedVerification()
      }).success
    ).toBe(false)
  })

  it('keeps verification status consistent with its checks', () => {
    const contradictory = {
      ...(passedVerification() as Record<string, unknown>),
      checks: [{ name: 'content', status: 'failed', message: '内容不一致。' }]
    }

    expect(VerificationReportSchema.safeParse(contradictory).success).toBe(false)
  })

  it('requires a safe error only for failed task states', () => {
    const failed = {
      schemaVersion: 1,
      taskId: TASK_ID,
      state: 'failed',
      progress: 0.5,
      message: '处理失败。'
    }

    expect(TaskProgressSchema.safeParse(failed).success).toBe(false)
    expect(
      TaskProgressSchema.safeParse({ ...failed, error: createAppError('INVALID_DOCUMENT') }).success
    ).toBe(true)
  })
})

describe('strict report and IPC contracts', () => {
  it('rejects sensitive metadata values and unknown fields from reports', () => {
    const report = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      taskId: TASK_ID,
      startedAt: '2026-08-09T10:00:00+08:00',
      completedAt: '2026-08-09T10:00:01+08:00',
      status: 'completed',
      warnings: [],
      files: [
        {
          input: { displayName: 'input.docx', documentType: 'docx', size: 1, sha256: SHA_A },
          output: {
            displayName: 'input_sanitized.docx',
            documentType: 'docx',
            size: 2,
            sha256: SHA_B
          },
          outputDisplayName: 'input_sanitized.docx',
          fields: [
            {
              field: 'creator',
              category: 'person-identity',
              occurrences: 1,
              status: 'changed',
              originalValue: 'Sensitive Name'
            }
          ],
          warnings: [],
          verification: passedVerification()
        }
      ]
    }

    expect(SanitizationReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects unknown request envelope fields', () => {
    const request = {
      schemaVersion: 1,
      requestId: REQUEST_ID,
      payload: {},
      channel: 'arbitrary:channel'
    }

    expect(IpcRequestEnvelopeSchema.safeParse(request).success).toBe(false)
  })

  it('keeps public results path-free and internal worker messages strict', () => {
    expect(
      SanitizationTaskResultSchema.safeParse({
        schemaVersion: 1,
        taskId: TASK_ID,
        report: {},
        files: [],
        absolutePath: '/private/output.docx'
      }).success
    ).toBe(false)
    expect(
      WorkerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'cancel',
        taskId: TASK_ID,
        command: 'unexpected'
      }).success
    ).toBe(false)
    expect(
      WorkerResponseSchema.safeParse({
        schemaVersion: 1,
        type: 'error',
        taskId: TASK_ID,
        error: createAppError('INVALID_REQUEST'),
        stack: '/private/source.ts:1'
      }).success
    ).toBe(false)
  })
})

describe('safe errors', () => {
  it('never forwards unknown messages or stack traces', () => {
    const internal = toSafeAppError(new Error('secret path /private/file.docx'))

    expect(internal.code).toBe('INTERNAL_ERROR')
    expect(internal.message).not.toContain('secret path')
    expect('stack' in internal).toBe(false)
    expect(AppErrorSchema.parse(internal)).toEqual(internal)

    const normalized = toSafeAppError({
      schemaVersion: 1,
      code: 'INVALID_DOCUMENT',
      message: 'secret path /private/file.docx',
      retryable: false
    })
    expect(normalized.message).toBe('文件结构无效或已损坏。')
  })
})

import { mkdtemp, readFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AppErrorSchema,
  DiagnosticEventSchema,
  DiagnosticSummarySchema,
  createAppError
} from '../../src/shared/contracts'
import { DiagnosticRecorder } from '../../src/main/diagnostics/diagnosticRecorder'

describe('privacy-safe diagnostics', () => {
  it('adds a stage without accepting sensitive fields', () => {
    const error = createAppError('INTERNAL_ERROR', {
      detailId: randomUUID(),
      stage: 'document-parse'
    })
    expect(AppErrorSchema.parse(error)).toMatchObject({ stage: 'document-parse' })
    expect(AppErrorSchema.safeParse({ ...error, path: '/private/a.docx' }).success).toBe(false)
  })

  it('writes allow-listed events and returns a filtered summary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-diagnostics-'))
    const recorder = new DiagnosticRecorder({ directory, appVersion: '1.0.0' })
    const detailId = await recorder.record({
      taskType: 'sanitization',
      stage: 'document-write',
      code: 'INTERNAL_ERROR',
      systemCategory: 'document'
    })
    const summary = DiagnosticSummarySchema.parse(await recorder.summary(detailId))
    expect(summary.events).toHaveLength(1)
    expect(JSON.stringify(summary)).not.toContain(directory)

    const text = await readFile(join(directory, 'diagnostics.jsonl'), 'utf8')
    const event = DiagnosticEventSchema.parse(JSON.parse(text.trim()))
    expect(event.detailId).toBe(detailId)
    expect(text).not.toContain('apiKey')
  })

  it('ignores expired files while retaining recent events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-diagnostics-'))
    const now = new Date('2026-08-10T00:00:00.000Z')
    const recorder = new DiagnosticRecorder({ directory, appVersion: '1.0.0', now: () => now })
    const detailId = await recorder.record({ code: 'INTERNAL_ERROR' })
    const path = join(directory, 'diagnostics.jsonl')
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000)
    await utimes(path, old, old)
    expect(await recorder.summary(detailId)).toMatchObject({ detailId, events: [] })
  })
})

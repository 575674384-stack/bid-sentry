import { describe, expect, it } from 'vitest'
import {
  buildSanitizationReport,
  renderSanitizationReportHtml,
  serializeSanitizationReport
} from '../../src/core/sanitization/report'
import type { SanitizationFileResult } from '../../src/shared/contracts'

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function fileResult(): SanitizationFileResult {
  return {
    input: {
      displayName: '<img src=x onerror=alert(1)>.docx',
      documentType: 'docx',
      size: 1_024,
      sha256: SHA_A
    },
    output: {
      displayName: 'output.docx',
      documentType: 'docx',
      size: 1_100,
      sha256: SHA_B
    },
    outputDisplayName: 'output.docx',
    fields: [
      {
        field: 'dc:creator',
        category: 'person-identity',
        occurrences: 2,
        status: 'changed'
      }
    ],
    warnings: ['<script>window.stolen = true</script>'],
    verification: {
      schemaVersion: 1,
      status: 'passed',
      checks: [{ name: 'content', status: 'passed', message: '内容指纹一致。' }],
      inputSha256: SHA_A,
      outputSha256: SHA_B
    }
  }
}

describe('sanitization reports', () => {
  it('uses one schema-validated object for JSON and HTML', () => {
    const report = buildSanitizationReport({
      appVersion: '0.1.0',
      taskId: TASK_ID,
      startedAt: '2026-08-09T10:00:00+08:00',
      completedAt: '2026-08-09T10:00:01+08:00',
      status: 'completed',
      files: [fileResult()],
      warnings: ['需要人工复核。']
    })

    const json = serializeSanitizationReport(report)
    const html = renderSanitizationReportHtml(report)

    expect(JSON.parse(json)).toEqual(report)
    expect(html).toContain(TASK_ID)
    expect(html).toContain(SHA_A)
    expect(html).toContain('dc:creator')
  })

  it('escapes all user-controlled HTML and emits no scripts', () => {
    const report = buildSanitizationReport({
      appVersion: '0.1.0',
      taskId: TASK_ID,
      startedAt: '2026-08-09T10:00:00+08:00',
      completedAt: '2026-08-09T10:00:01+08:00',
      status: 'completed',
      files: [fileResult()],
      warnings: []
    })
    const html = renderSanitizationReportHtml(report)

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.docx')
    expect(html).toContain('&lt;script&gt;window.stolen = true&lt;/script&gt;')
  })

  it('never serializes metadata values that are not part of the report contract', () => {
    const report = buildSanitizationReport({
      appVersion: '0.1.0',
      taskId: TASK_ID,
      startedAt: '2026-08-09T10:00:00+08:00',
      completedAt: '2026-08-09T10:00:01+08:00',
      status: 'completed',
      files: [fileResult()],
      warnings: []
    })
    const combined = `${serializeSanitizationReport(report)}${renderSanitizationReportHtml(report)}`

    expect(combined).not.toContain('Sensitive Person Name')
    expect(combined).not.toContain('User-ABCDEF123456')
    expect(combined).not.toContain('originalValue')
    expect(combined).not.toContain('randomizedValue')
  })
})

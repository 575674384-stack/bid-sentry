import { describe, expect, it } from 'vitest'
import { buildReviewReport } from '../../src/core/review/report'
import { PathRegistry } from '../../src/main/ipc/pathRegistry'

describe('result capability registry', () => {
  it('registers review and generation files without exposing paths', () => {
    const registry = new PathRegistry()
    const review = registry.registerReviewResult(7, '/tmp/bid-sentry-output', {
      schemaVersion: 1,
      taskId: '123e4567-e89b-42d3-a456-426614174000',
      report: buildReviewReport(
        '123e4567-e89b-42d3-a456-426614174000',
        'tender.docx',
        'bid.docx',
        []
      ),
      jsonReport: 'bid-review.json',
      htmlReport: 'bid-review.html',
      files: []
    })
    expect(review.files).toHaveLength(2)
    expect(review.files.map((file) => file.displayName)).toEqual([
      'bid-review.json',
      'bid-review.html'
    ])
    expect(registry.resolveResultFile(7, review.files[0]!.fileId)).toBe(
      '/tmp/bid-sentry-output/bid-review.json'
    )
    expect(() => registry.resolveResultFile(8, review.files[0]!.fileId)).toThrow()

    const generation = registry.registerGenerationResult(7, '/tmp/bid-sentry-output', {
      schemaVersion: 1,
      taskId: '223e4567-e89b-42d3-a456-426614174000',
      outputName: 'qualification.docx',
      reportName: 'qualification.json',
      warnings: [],
      files: []
    })
    expect(generation.files.map((file) => file.kind)).toEqual(['generated-document', 'json-report'])
  })

  it('rejects traversal display names before capability registration', () => {
    const registry = new PathRegistry()
    expect(() =>
      registry.registerGenerationResult(1, '/tmp/bid-sentry-output', {
        schemaVersion: 1,
        taskId: '323e4567-e89b-42d3-a456-426614174000',
        outputName: '../outside.docx',
        reportName: 'report.json',
        warnings: [],
        files: []
      })
    ).toThrow()
  })
})

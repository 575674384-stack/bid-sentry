import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ReviewReportSchema, type ReviewFinding, type ReviewReport } from '../../shared/contracts'

export async function writeReviewReport(
  directory: string,
  taskId: string,
  tenderName: string,
  bidName: string,
  findings: ReviewFinding[]
): Promise<{ report: ReviewReport; jsonPath: string; htmlPath: string }> {
  const report = ReviewReportSchema.parse({
    schemaVersion: 1,
    taskId,
    tenderName,
    bidName,
    findings,
    deterministicCount: findings.filter((finding) => finding.source === 'deterministic').length,
    aiCount: findings.filter((finding) => finding.source === 'ai').length,
    status: 'completed',
    generatedAt: new Date().toISOString()
  })
  const jsonPath = join(directory, `bid-review-${taskId}.json`)
  const htmlPath = join(directory, `bid-review-${taskId}.html`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  const rows = findings
    .map(
      (finding) =>
        `<tr><td>${escape(finding.severity)}</td><td>${escape(finding.summary)}</td><td>${escape(finding.suggestion)}</td></tr>`
    )
    .join('')
  await writeFile(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><title>Bid Sentry 对照审查</title><h1>对照审查报告</h1><p>AI 结果必须人工复核；本报告不会自动修改投标文件。</p><table><thead><tr><th>级别</th><th>问题</th><th>建议</th></tr></thead><tbody>${rows}</tbody></table>`,
    { mode: 0o600 }
  )
  return { report, jsonPath, htmlPath }
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character
  )
}

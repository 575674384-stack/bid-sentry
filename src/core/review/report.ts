import { ReviewReportSchema, type ReviewFinding, type ReviewReport } from '../../shared/contracts'

export function buildReviewReport(
  taskId: string,
  tenderName: string,
  bidName: string,
  findings: ReviewFinding[],
  hashes?: { tenderSha256: string; bidSha256: string }
): ReviewReport {
  return ReviewReportSchema.parse({
    schemaVersion: 1,
    taskId,
    tenderName,
    bidName,
    ...(hashes ?? {}),
    findings,
    deterministicCount: findings.filter((finding) => finding.source === 'deterministic').length,
    aiCount: findings.filter((finding) => finding.source === 'ai').length,
    status: 'completed',
    generatedAt: new Date().toISOString()
  })
}

export function serializeReviewReport(report: ReviewReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderReviewReportHtml(findings: readonly ReviewFinding[]): string {
  const rows = findings
    .map((finding) => {
      const evidence = [...finding.tenderEvidence, ...finding.bidEvidence]
        .map(
          (item) =>
            `<li>${escape(item.document)} / ${escape(item.label)} / ${escape(item.nodeId)}：${escape(item.excerpt)}</li>`
        )
        .join('')
      return `<tr><td>${escape(finding.severity)}</td><td>${escape(finding.source)}</td><td>${escape(String(finding.confidence))}</td><td>${escape(finding.summary)}</td><td>${escape(finding.suggestion)}</td><td><ul>${evidence}</ul></td></tr>`
    })
    .join('')
  return `<!doctype html><meta charset="utf-8"><title>Bid Sentry 对照审查</title><h1>对照审查报告</h1><p>AI 结果必须人工复核；本报告不会自动修改投标文件。</p><table><thead><tr><th>级别</th><th>来源</th><th>置信度</th><th>问题</th><th>建议</th><th>证据（角色/节点/摘录）</th></tr></thead><tbody>${rows}</tbody></table>`
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character
  )
}

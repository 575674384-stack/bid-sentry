import {
  SanitizationReportSchema,
  type SanitizationFileResult,
  type SanitizationReport
} from '../../shared/contracts/sanitization'

export interface SanitizationReportInput {
  appVersion: string
  taskId: string
  startedAt: string
  completedAt: string
  status: 'completed' | 'failed' | 'cancelled'
  files: SanitizationFileResult[]
  warnings: string[]
}

export function buildSanitizationReport(input: SanitizationReportInput): SanitizationReport {
  return SanitizationReportSchema.parse({
    schemaVersion: 1,
    ...input
  })
}

export function serializeSanitizationReport(reportInput: SanitizationReport): string {
  const report = SanitizationReportSchema.parse(reportInput)
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderSanitizationReportHtml(reportInput: SanitizationReport): string {
  const report = SanitizationReportSchema.parse(reportInput)
  const fileSections = report.files.map(renderFileSection).join('\n')
  const warnings = report.warnings.length
    ? `<ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '<p>无任务级警告。</p>'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bid Sentry 元数据处理报告</title>
  <style>
    body{max-width:960px;margin:40px auto;padding:0 24px;color:#183247;font:15px/1.65 system-ui,sans-serif;background:#f5f8fa}
    h1,h2{color:#102a43}section,.summary{margin:20px 0;padding:20px;border:1px solid #d6e2e9;border-radius:12px;background:#fff}
    table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e7eef2;text-align:left;vertical-align:top}
    code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.passed{color:#147d64}.warning{color:#a85d00}
  </style>
</head>
<body>
  <h1>Bid Sentry 元数据处理报告</h1>
  <div class="summary">
    <p><strong>任务状态：</strong>${escapeHtml(statusLabel(report.status))}</p>
    <p><strong>应用版本：</strong>${escapeHtml(report.appVersion)}</p>
    <p><strong>任务 ID：</strong><code>${escapeHtml(report.taskId)}</code></p>
    <p><strong>开始时间：</strong>${escapeHtml(report.startedAt)}</p>
    <p><strong>完成时间：</strong>${escapeHtml(report.completedAt)}</p>
  </div>
  <h2>任务警告</h2>
  ${warnings}
  <h2>文件结果</h2>
  ${fileSections || '<p>本任务没有生成文件结果。</p>'}
  <p>报告仅记录字段类别和处理状态，不包含清洗前后的元数据值。</p>
</body>
</html>
`
}

function renderFileSection(file: SanitizationFileResult): string {
  const fields = file.fields
    .map(
      (field) => `<tr>
        <td>${escapeHtml(field.field)}</td>
        <td>${escapeHtml(field.category)}</td>
        <td>${field.occurrences}</td>
        <td>${escapeHtml(field.status)}</td>
      </tr>`
    )
    .join('')
  const warnings = file.warnings.length
    ? `<ul class="warning">${file.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '<p>无文件级警告。</p>'

  return `<section>
    <h2>${escapeHtml(file.input.displayName)} → ${escapeHtml(file.outputDisplayName)}</h2>
    <p><strong>输入指纹：</strong><code>${escapeHtml(file.input.sha256)}</code></p>
    <p><strong>输出指纹：</strong><code>${escapeHtml(file.output.sha256)}</code></p>
    <p class="${file.verification.status === 'passed' ? 'passed' : 'warning'}"><strong>验证：</strong>${escapeHtml(file.verification.status)}</p>
    <table>
      <thead><tr><th>字段</th><th>类别</th><th>数量</th><th>状态</th></tr></thead>
      <tbody>${fields}</tbody>
    </table>
    ${warnings}
  </section>`
}

function statusLabel(status: SanitizationReport['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '失败'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

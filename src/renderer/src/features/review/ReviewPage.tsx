import { useState } from 'react'
import type {
  ReviewResult,
  SelectedInputFile,
  SelectedOutputDirectory
} from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'

export function ReviewPage(): React.JSX.Element {
  const [files, setFiles] = useState<SelectedInputFile[]>([])
  const [tenderId, setTenderId] = useState('')
  const [bidId, setBidId] = useState('')
  const [output, setOutput] = useState<SelectedOutputDirectory | null>(null)
  const [bidderName, setBidderName] = useState('')
  const [aiConfirmed, setAiConfirmed] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseFiles = async (): Promise<void> => {
    try {
      const selected = await bidSentryApi.selectInputFiles()
      setFiles(selected.files)
      setTenderId(selected.files[0]?.inputId ?? '')
      setBidId(selected.files[1]?.inputId ?? '')
      setResult(null)
    } catch (reason) {
      setError(userMessage(reason))
    }
  }
  const chooseOutput = async (): Promise<void> => {
    try {
      setOutput(await bidSentryApi.selectOutputDirectory())
    } catch (reason) {
      setError(userMessage(reason))
    }
  }
  const run = async (): Promise<void> => {
    if (!tenderId || !bidId || tenderId === bidId || !output || !bidderName.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResult(
        await bidSentryApi.runReview({
          schemaVersion: 1,
          tenderInputId: tenderId,
          bidInputId: bidId,
          outputDirectoryId: output.outputDirectoryId,
          bidderName: bidderName.trim(),
          aiConfirmed
        })
      )
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack review-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="step-label">步骤 1</p>
            <h2>选择招标文件与投标文件</h2>
          </div>
          <span className="status-chip success">本机规则优先</span>
        </div>
        <p className="panel-intro">
          文件只在本机读取。启用 AI 后，会在确认的接口上发送截断后的文本和结构锚点，不发送文件路径。
        </p>
        <div className="review-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseFiles()}
            disabled={busy}
          >
            选择两个文件
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseOutput()}
            disabled={busy}
          >
            选择报告目录
          </button>
        </div>
        <div className="review-file-grid">
          <label>
            <span>招标文件</span>
            <select
              value={tenderId}
              onChange={(event) => setTenderId(event.currentTarget.value)}
              disabled={busy}
            >
              <option value="">请选择</option>
              {files.map((file) => (
                <option key={file.inputId} value={file.inputId}>
                  {file.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>投标文件</span>
            <select
              value={bidId}
              onChange={(event) => setBidId(event.currentTarget.value)}
              disabled={busy}
            >
              <option value="">请选择</option>
              {files.map((file) => (
                <option key={file.inputId} value={file.inputId}>
                  {file.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>确认的投标单位名称</span>
            <input
              value={bidderName}
              onChange={(event) => setBidderName(event.currentTarget.value)}
              placeholder="例如：示例建设有限公司"
              disabled={busy}
            />
          </label>
        </div>
        <label className="review-consent">
          <input
            type="checkbox"
            checked={aiConfirmed}
            onChange={(event) => setAiConfirmed(event.currentTarget.checked)}
            disabled={busy}
          />
          <span>
            <strong>我确认允许使用已配置的 AI 接口辅助审查</strong>
            <small>AI 结果会降级为“需人工复核”，不会自动修改投标文件。</small>
          </span>
        </label>
        {output ? <p className="inline-hint">报告目录：{output.displayName}</p> : null}
        {error ? (
          <div className="notice danger" role="alert">
            <strong>审查未完成</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <button
          className="button primary"
          type="button"
          onClick={() => void run()}
          disabled={
            busy || !tenderId || !bidId || tenderId === bidId || !output || !bidderName.trim()
          }
        >
          {busy ? '正在解析与审查…' : '开始对照审查'}
        </button>
      </section>
      {result ? <ReviewResultPanel result={result} /> : null}
    </div>
  )
}

function ReviewResultPanel({ result }: { result: ReviewResult }): React.JSX.Element {
  return (
    <section className="panel review-result">
      <div className="panel-heading">
        <div>
          <p className="step-label">步骤 2</p>
          <h2>审查结果</h2>
        </div>
        <span className="status-chip success">已生成报告</span>
      </div>
      <p className="panel-intro">
        发现 {result.report.findings.length} 项，确定性规则 {result.report.deterministicCount}{' '}
        项，AI 辅助 {result.report.aiCount} 项。请逐条人工复核。
      </p>
      <div className="findings-list">
        {result.report.findings.length ? (
          result.report.findings.map((finding) => (
            <article className={`finding-card severity-${finding.severity}`} key={finding.id}>
              <div className="finding-heading">
                <span>{finding.severity}</span>
                <strong>{finding.summary}</strong>
                <small>
                  {finding.source === 'ai' ? 'AI 辅助' : '本机规则'} · 置信度{' '}
                  {Math.round(finding.confidence * 100)}%
                </small>
              </div>
              <p>{finding.suggestion}</p>
              <div className="finding-evidence">
                <span>
                  招标：
                  {finding.tenderEvidence.map((evidence) => evidence.excerpt).join('；') || '无'}
                </span>
                <span>
                  投标：{finding.bidEvidence.map((evidence) => evidence.excerpt).join('；') || '无'}
                </span>
              </div>
            </article>
          ))
        ) : (
          <p className="quiet-message">未发现规则问题；仍请人工检查完整文件。</p>
        )}
      </div>
      <div className="report-files">
        <span>JSON：{result.jsonReport}</span>
        <span>HTML：{result.htmlReport}</span>
      </div>
    </section>
  )
}

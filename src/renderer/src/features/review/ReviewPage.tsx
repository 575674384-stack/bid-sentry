import { useEffect, useState } from 'react'
import type {
  AiSettings,
  ReviewFinding,
  ReviewResult,
  SelectedInputFile
} from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'
import { IconCompare, IconFile, IconFolder } from '../../components/icons'
import { Notice, Stepper, formatBytes } from '../../components/ui'

const STEPS = [
  { key: 'select', label: '选择文件' },
  { key: 'run', label: '执行审查' },
  { key: 'result', label: '审查结果' }
] as const

const SEVERITY_LABELS: Readonly<Record<ReviewFinding['severity'], string>> = {
  error: '错误',
  warning: '警告',
  'needs-review': '需人工复核',
  info: '提示'
}

const SEVERITY_TONES: Readonly<Record<ReviewFinding['severity'], string>> = {
  error: 'badge-danger',
  warning: 'badge-warning',
  'needs-review': 'badge-primary',
  info: 'badge-neutral'
}

const TYPE_LABELS: Readonly<Record<ReviewFinding['type'], string>> = {
  'multiple-bidder-names': '多个投标单位名称',
  'role-confusion': '角色混淆',
  'project-mismatch': '项目名称不符',
  'fixed-parameter-mismatch': '固定参数不符',
  'internal-conflict': '内容自相矛盾',
  'missing-response': '未响应要求',
  'template-placeholder': '模板内容残留',
  'ai-suggestion': 'AI 建议'
}

export function ReviewPage(): React.JSX.Element {
  const [files, setFiles] = useState<SelectedInputFile[]>([])
  const [tenderId, setTenderId] = useState('')
  const [bidId, setBidId] = useState('')
  const [bidderName, setBidderName] = useState('')
  const [aiConfirmed, setAiConfirmed] = useState(false)
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    bidSentryApi
      .getSettings()
      .then((settings) => {
        if (!active) return
        setAiSettings(settings)
        setBidderName((current) => current || settings.companyProfile.bidderName)
      })
      .catch(() => {
        if (active) setAiSettings(null)
      })
    return () => {
      active = false
    }
  }, [])

  const chooseFiles = async (): Promise<void> => {
    try {
      const selected = await bidSentryApi.selectInputFiles()
      if (selected.files.length === 0) return
      setFiles(selected.files)
      setTenderId(selected.files[0]?.inputId ?? '')
      setBidId(selected.files[1]?.inputId ?? '')
      setResult(null)
      setError(null)
    } catch (reason) {
      setError(userMessage(reason))
    }
  }

  const run = async (): Promise<void> => {
    if (!tenderId || !bidId || tenderId === bidId || !bidderName.trim()) return
    setBusy(true)
    setError(null)
    let startedTaskId: string | null = null
    try {
      const started = await bidSentryApi.startReview()
      startedTaskId = started.taskId
      setTaskId(started.taskId)
      setResult(
        await bidSentryApi.runReview({
          schemaVersion: 1,
          taskId: started.taskId,
          tenderInputId: tenderId,
          bidInputId: bidId,
          bidderName: bidderName.trim(),
          aiConfirmed
        })
      )
    } catch (reason) {
      if (startedTaskId) await bidSentryApi.cancelReview(startedTaskId).catch(() => undefined)
      setError(userMessage(reason))
    } finally {
      setBusy(false)
      setTaskId(null)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!taskId) return
    try {
      await bidSentryApi.cancelReview(taskId)
    } catch (reason) {
      setError(userMessage(reason))
    }
  }

  const canRun =
    !busy && Boolean(tenderId) && Boolean(bidId) && tenderId !== bidId && Boolean(bidderName.trim())
  const currentStep = result ? 2 : busy ? 1 : 0

  return (
    <div className="card-stack" data-testid="review-page">
      <Stepper steps={STEPS} current={currentStep} />

      <section className="card" aria-labelledby="review-setup-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="review-setup-title">
              选择文件与审查参数
            </h2>
            <p className="card-sub">
              先选招标文件，再选投标文件；文件只在本机读取，审查报告保存到投标文件所在目录。
            </p>
          </div>
          <span className="badge badge-neutral">本机规则优先</span>
        </div>

        <div className="card-stack">
          <div className="dropzone">
            <span className="dropzone-icon" aria-hidden="true">
              <IconCompare size={22} />
            </span>
            <div className="dropzone-text">
              <p className="dropzone-title">一次选择招标文件和投标文件</p>
              <p className="dropzone-desc">
                选中后在下方分别指定角色；同一份文件不能同时作为双方。
              </p>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              data-testid="review-select-files"
              onClick={() => void chooseFiles()}
              disabled={busy}
            >
              {files.length ? '重新选择文件' : '选择文件'}
            </button>
          </div>

          {files.length > 0 ? (
            <ul className="file-list" aria-label="已选择的文件">
              {files.map((file) => (
                <li className="file-row" key={file.inputId}>
                  <span className={`file-tag file-tag-${file.documentType}`}>
                    {file.documentType}
                  </span>
                  <span className="file-name" title={file.displayName}>
                    {file.displayName}
                  </span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="form-grid">
            <label className="field">
              <span className="field-label">
                招标文件<span className="req">*</span>
              </span>
              <select
                className="select"
                value={tenderId}
                onChange={(event) => setTenderId(event.currentTarget.value)}
                disabled={busy || files.length === 0}
              >
                <option value="">请选择</option>
                {files.map((file) => (
                  <option key={file.inputId} value={file.inputId}>
                    {file.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                投标文件<span className="req">*</span>
              </span>
              <select
                className="select"
                value={bidId}
                onChange={(event) => setBidId(event.currentTarget.value)}
                disabled={busy || files.length === 0}
              >
                <option value="">请选择</option>
                {files.map((file) => (
                  <option key={file.inputId} value={file.inputId}>
                    {file.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field span-2">
              <span className="field-label">
                投标单位名称<span className="req">*</span>
              </span>
              <input
                className="input"
                value={bidderName}
                onChange={(event) => setBidderName(event.currentTarget.value)}
                placeholder="用于核对投标文件中出现的单位名称，例如：示例建设有限公司"
                disabled={busy}
              />
              <span className="field-hint">与投标文件盖章、落款使用的全称保持一致。</span>
            </label>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={aiConfirmed}
              onChange={(event) => setAiConfirmed(event.currentTarget.checked)}
              disabled={busy}
            />
            <span>
              <span className="check-title">允许使用已配置的 AI 接口辅助审查</span>
              <span className="check-hint">
                仅发送双方必要的文本片段（每份最多约 7,000 字节，单次请求不超过 256 KiB）；AI
                结论一律降级为「需人工复核」，不会修改任何文件。
              </span>
              {aiConfirmed && aiSettings ? (
                <span className="check-hint">
                  发送目标：{safeHost(aiSettings.baseUrl)} · 模型：{aiSettings.model}
                </span>
              ) : null}
            </span>
          </label>

          <p className="output-line">
            <IconFolder />
            <span>报告位置：与投标文件同目录（无需选择输出目录）</span>
          </p>

          {error ? (
            <Notice tone="danger" title="审查未完成">
              {error}
            </Notice>
          ) : null}

          <div className="btn-row is-between">
            <span className="btn-note">
              {busy ? '正在解析与审查，可随时取消。' : '审查过程不会修改任何文件。'}
            </span>
            <div className="btn-row">
              {busy ? (
                <button
                  className="btn btn-danger"
                  type="button"
                  data-testid="review-cancel"
                  onClick={() => void cancel()}
                >
                  取消审查
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                type="button"
                data-testid="review-run"
                onClick={() => void run()}
                disabled={!canRun}
              >
                {busy ? '正在审查…' : '开始审查'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {busy ? (
        <section className="card" aria-live="polite">
          <p className="loading-line">
            <span className="spinner" aria-hidden="true" />
            正在对照招标文件核查投标文件…
          </p>
        </section>
      ) : null}

      {result ? (
        <ReviewResultPanel
          result={result}
          onRestart={() => {
            setResult(null)
            setError(null)
          }}
        />
      ) : null}
    </div>
  )
}

function ReviewResultPanel({
  result,
  onRestart
}: {
  result: ReviewResult
  onRestart(): void
}): React.JSX.Element {
  const [severity, setSeverity] = useState('all')
  const [source, setSource] = useState('all')
  const findings = result.report.findings.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) &&
      (source === 'all' || finding.source === source)
  )
  return (
    <section className="card" aria-labelledby="review-result-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="review-result-title">
            审查结果
          </h2>
          <p className="card-sub">请逐条人工复核；报告文件已保存到投标文件所在目录。</p>
        </div>
        <span className="badge badge-success">已生成报告</span>
      </div>

      <div className="card-stack">
        <div className="stat-row" aria-label="结果统计">
          <span className="stat-chip">
            全部发现 <strong>{result.report.findings.length}</strong>
          </span>
          <span className="stat-chip">
            确定性规则 <strong>{result.report.deterministicCount}</strong>
          </span>
          <span className="stat-chip">
            AI 辅助 <strong>{result.report.aiCount}</strong>
          </span>
        </div>

        <div className="form-grid">
          <label className="field">
            <span className="field-label">按严重程度筛选</span>
            <select
              className="select"
              value={severity}
              onChange={(event) => setSeverity(event.currentTarget.value)}
            >
              <option value="all">全部</option>
              <option value="error">错误</option>
              <option value="warning">警告</option>
              <option value="needs-review">需人工复核</option>
              <option value="info">提示</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">按来源筛选</span>
            <select
              className="select"
              value={source}
              onChange={(event) => setSource(event.currentTarget.value)}
            >
              <option value="all">全部</option>
              <option value="deterministic">本机规则</option>
              <option value="ai">AI 辅助</option>
            </select>
          </label>
        </div>

        {findings.length ? (
          <div className="card-stack" aria-label="发现列表">
            {findings.map((finding) => (
              <article
                className={`finding sev-${finding.severity}`}
                key={finding.id}
                data-testid="review-finding"
              >
                <div className="finding-head">
                  <span className={`badge ${SEVERITY_TONES[finding.severity]}`}>
                    {SEVERITY_LABELS[finding.severity]}
                  </span>
                  <span className="badge badge-neutral">{TYPE_LABELS[finding.type]}</span>
                  <span className="finding-meta">
                    {finding.source === 'ai' ? 'AI 辅助' : '本机规则'} · 置信度{' '}
                    {Math.round(finding.confidence * 100)}%
                  </span>
                </div>
                <p className="finding-summary">{finding.summary}</p>
                {finding.suggestion ? <p className="muted text-sm">{finding.suggestion}</p> : null}
                <div className="finding-evidence">
                  <div>
                    <span className="finding-meta">招标文件依据</span>
                    {finding.tenderEvidence.length ? (
                      finding.tenderEvidence.map((evidence) => (
                        <blockquote key={`t-${evidence.nodeId}`}>{evidence.excerpt}</blockquote>
                      ))
                    ) : (
                      <blockquote>无直接引用</blockquote>
                    )}
                  </div>
                  <div>
                    <span className="finding-meta">投标文件内容</span>
                    {finding.bidEvidence.length ? (
                      finding.bidEvidence.map((evidence) => (
                        <blockquote key={`b-${evidence.nodeId}`}>{evidence.excerpt}</blockquote>
                      ))
                    ) : (
                      <blockquote>无直接引用</blockquote>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Notice tone="info">当前筛选条件下没有发现；仍请人工检查完整文件。</Notice>
        )}

        <div className="card-stack">
          <p className="muted text-sm">
            报告文件：{result.jsonReport} · {result.htmlReport}
          </p>
          <div className="btn-row">
            {result.files.map((file) => (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                key={file.fileId}
                aria-label={`在文件夹中显示 ${file.displayName}`}
                onClick={() => void bidSentryApi.showResultInFolder(file.fileId)}
              >
                <IconFile size={14} />
                {file.displayName}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" type="button" onClick={onRestart}>
              开始新的审查
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return '已配置接口'
  }
}

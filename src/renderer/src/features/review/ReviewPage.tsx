import { useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Input, Select, Spin, Steps, Tag, Typography } from 'antd'
import type {
  AiSettings,
  ReviewFinding,
  ReviewResult,
  SelectedInputFile
} from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'
import { onSettingsChanged } from '../settings/settingsEvents'
import { formatBytes } from '../../components/ui'

const STEPS = [{ title: '选择文件' }, { title: '执行审查' }, { title: '审查结果' }]

const SEVERITY_LABELS: Readonly<Record<ReviewFinding['severity'], string>> = {
  error: '错误',
  warning: '警告',
  'needs-review': '需人工复核',
  info: '提示'
}

const SEVERITY_COLORS: Readonly<Record<ReviewFinding['severity'], string>> = {
  error: 'error',
  warning: 'warning',
  'needs-review': 'processing',
  info: 'default'
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
    const apply = (settings: AiSettings): void => {
      setAiSettings(settings)
      setBidderName((current) => current || settings.companyProfile.bidderName)
    }
    bidSentryApi
      .getSettings()
      .then((settings) => {
        if (active) apply(settings)
      })
      .catch(() => {
        if (active) setAiSettings(null)
      })
    const unsubscribe = onSettingsChanged((settings) => {
      if (active) apply(settings)
    })
    return () => {
      active = false
      unsubscribe()
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
    <div className="stack" data-testid="review-page">
      <Steps size="small" current={currentStep} items={STEPS} style={{ maxWidth: 560 }} />

      <Card title="选择文件与审查参数">
        <div className="stack">
          <div className="dropzone">
            <div className="dropzone-text">
              <p className="dropzone-title">一次选择招标文件和投标文件</p>
              <p className="dropzone-desc">
                选中后在下方分别指定角色；报告保存到投标文件所在目录。
              </p>
            </div>
            <Button
              type="primary"
              data-testid="review-select-files"
              onClick={() => void chooseFiles()}
              disabled={busy}
            >
              {files.length ? '重新选择文件' : '选择文件'}
            </Button>
          </div>

          {files.length > 0 ? (
            <ul className="file-list" aria-label="已选择的文件">
              {files.map((file) => (
                <li className="file-row" key={file.inputId}>
                  <Tag color={file.documentType === 'docx' ? 'geekblue' : 'volcano'}>
                    {file.documentType}
                  </Tag>
                  <span className="file-name" title={file.displayName}>
                    {file.displayName}
                  </span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12
            }}
          >
            <label className="field-block">
              <span className="field-label">招标文件 *</span>
              <Select
                style={{ width: '100%' }}
                value={tenderId || undefined}
                placeholder="请选择"
                aria-label="招标文件"
                onChange={(value) => setTenderId(value ?? '')}
                disabled={busy || files.length === 0}
                options={files.map((file) => ({ value: file.inputId, label: file.displayName }))}
              />
            </label>
            <label className="field-block">
              <span className="field-label">投标文件 *</span>
              <Select
                style={{ width: '100%' }}
                value={bidId || undefined}
                placeholder="请选择"
                aria-label="投标文件"
                onChange={(value) => setBidId(value ?? '')}
                disabled={busy || files.length === 0}
                options={files.map((file) => ({ value: file.inputId, label: file.displayName }))}
              />
            </label>
            <label className="field-block" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">投标单位名称 *</span>
              <Input
                value={bidderName}
                onChange={(event) => setBidderName(event.currentTarget.value)}
                placeholder="与投标文件盖章、落款使用的全称保持一致"
                disabled={busy}
              />
            </label>
          </div>

          <Checkbox
            checked={aiConfirmed}
            onChange={(event) => setAiConfirmed(event.target.checked)}
            disabled={busy}
          >
            允许使用已配置的 AI 接口辅助审查
            {aiConfirmed && aiSettings ? (
              <span className="muted text-sm" style={{ marginLeft: 8 }}>
                发送目标：{safeHost(aiSettings.baseUrl)} · 模型：{aiSettings.model}
              </span>
            ) : null}
          </Checkbox>

          {error ? <Alert type="error" showIcon title="审查未完成" description={error} /> : null}

          <div className="actions">
            {busy ? (
              <Button danger data-testid="review-cancel" onClick={() => void cancel()}>
                取消审查
              </Button>
            ) : null}
            <Button
              type="primary"
              data-testid="review-run"
              onClick={() => void run()}
              disabled={!canRun}
              loading={busy}
            >
              {busy ? '正在审查…' : '开始审查'}
            </Button>
          </div>
        </div>
      </Card>

      {busy ? (
        <Card>
          <Spin /> <span className="muted text-sm">正在对照招标文件核查投标文件…</span>
        </Card>
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
    <Card
      title={<h2 style={{ margin: 0, fontSize: 16 }}>审查结果</h2>}
      extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Tag color="default">全部 {result.report.findings.length}</Tag>
          <Tag color="processing">本机规则 {result.report.deterministicCount}</Tag>
          <Tag color="warning">AI 辅助 {result.report.aiCount}</Tag>
        </div>
      }
    >
      <div className="stack">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Select
            size="small"
            style={{ width: 160 }}
            value={severity}
            onChange={setSeverity}
            aria-label="按严重程度筛选"
            options={[
              { value: 'all', label: '全部严重程度' },
              { value: 'error', label: '错误' },
              { value: 'warning', label: '警告' },
              { value: 'needs-review', label: '需人工复核' },
              { value: 'info', label: '提示' }
            ]}
          />
          <Select
            size="small"
            style={{ width: 140 }}
            value={source}
            onChange={setSource}
            aria-label="按来源筛选"
            options={[
              { value: 'all', label: '全部来源' },
              { value: 'deterministic', label: '本机规则' },
              { value: 'ai', label: 'AI 辅助' }
            ]}
          />
        </div>

        {findings.length ? (
          <div className="stack" aria-label="发现列表">
            {findings.map((finding) => (
              <Card size="small" key={finding.id} data-testid="review-finding">
                <div className="stack" style={{ gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Tag color={SEVERITY_COLORS[finding.severity]}>
                      {SEVERITY_LABELS[finding.severity]}
                    </Tag>
                    <Tag>{TYPE_LABELS[finding.type]}</Tag>
                    <span className="muted text-sm">
                      {finding.source === 'ai' ? 'AI 辅助' : '本机规则'} · 置信度{' '}
                      {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                  <span style={{ fontWeight: 500 }}>{finding.summary}</span>
                  {finding.suggestion ? (
                    <span className="muted text-sm">{finding.suggestion}</span>
                  ) : null}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: 10
                    }}
                  >
                    <EvidenceBlock title="招标文件依据" evidence={finding.tenderEvidence} />
                    <EvidenceBlock title="投标文件内容" evidence={finding.bidEvidence} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Alert type="info" showIcon title="当前筛选条件下没有发现；仍请人工检查完整文件。" />
        )}

        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          报告文件：{result.jsonReport} · {result.htmlReport}
        </Typography.Text>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {result.files.map((file) => (
            <Button
              size="small"
              key={file.fileId}
              aria-label={`在文件夹中显示 ${file.displayName}`}
              onClick={() => void bidSentryApi.showResultInFolder(file.fileId)}
            >
              {file.displayName}
            </Button>
          ))}
          <Button type="text" size="small" onClick={onRestart}>
            开始新的审查
          </Button>
        </div>
      </div>
    </Card>
  )
}

function EvidenceBlock({
  title,
  evidence
}: {
  title: string
  evidence: readonly { nodeId: string; excerpt: string }[]
}): React.JSX.Element {
  return (
    <div>
      <div className="muted text-sm" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {evidence.length ? (
        evidence.map((item) => (
          <blockquote
            key={item.nodeId}
            style={{
              margin: '0 0 6px',
              padding: '6px 10px',
              borderLeft: '3px solid #dfe3ea',
              background: '#f7f8fa',
              fontSize: 12.5,
              userSelect: 'text'
            }}
          >
            {item.excerpt}
          </blockquote>
        ))
      ) : (
        <span className="muted text-sm">无直接引用</span>
      )}
    </div>
  )
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return '已配置接口'
  }
}

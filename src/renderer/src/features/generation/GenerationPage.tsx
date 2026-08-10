import { useState } from 'react'
import type {
  GenerationPreview,
  GenerationResult,
  GenerationUserForm,
  SelectedInputFile,
  SelectedOutputDirectory
} from '../../../../shared/contracts'
import { GenerationUserFormSchema } from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'

const EMPTY_FORM: GenerationUserForm = {
  bidderName: '',
  unifiedSocialCreditCode: '',
  address: '',
  legalRepresentative: '',
  authorizedRepresentative: '',
  contact: '',
  phone: '',
  email: '',
  projectName: '',
  sectionName: '',
  compilationDate: ''
}

export function GenerationPage(): React.JSX.Element {
  const [file, setFile] = useState<SelectedInputFile | null>(null)
  const [output, setOutput] = useState<SelectedOutputDirectory | null>(null)
  const [form, setForm] = useState<GenerationUserForm>(EMPTY_FORM)
  const [preview, setPreview] = useState<GenerationPreview | null>(null)
  const [candidateId, setCandidateId] = useState('')
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseFile = async (): Promise<void> => {
    try {
      const selected = await bidSentryApi.selectInputFiles()
      const candidate = selected.files[0]
      if (!candidate) return
      setFile(candidate)
      setPreview(null)
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
  const update = (key: keyof GenerationUserForm, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }))
  const createPreview = async (): Promise<void> => {
    if (!file) return
    const parsed = GenerationUserFormSchema.safeParse(form)
    if (!parsed.success) {
      setError('请先填写投标单位名称等基础信息。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await bidSentryApi.previewGeneration({
        schemaVersion: 1,
        inputId: file.inputId,
        userForm: parsed.data
      })
      setPreview(value)
      setCandidateId(value.candidates[0]?.candidateId ?? '')
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const generate = async (): Promise<void> => {
    if (!file || !output || !candidateId) return
    const parsed = GenerationUserFormSchema.safeParse(form)
    if (!parsed.success) return
    setBusy(true)
    setError(null)
    try {
      setResult(
        await bidSentryApi.runGeneration({
          schemaVersion: 1,
          inputId: file.inputId,
          outputDirectoryId: output.outputDirectoryId,
          candidateId,
          userForm: parsed.data,
          confirmed: true
        })
      )
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page-stack generation-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="step-label">步骤 1–3</p>
            <h2>从招标模板预制作资格标</h2>
          </div>
          <span className="status-chip success">用户确认后生成</span>
        </div>
        <p className="panel-intro">
          会优先复用 DOCX 招标文件的原始模板；PDF
          仅进行可解释的结构化重建。固定值没有证据时不会猜测，图片/证照用占位符。
        </p>
        <div className="review-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseFile()}
            disabled={busy}
          >
            选择招标文件
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseOutput()}
            disabled={busy}
          >
            选择输出目录
          </button>
        </div>
        {file ? (
          <p className="inline-hint">
            模板：{file.displayName}（{file.documentType.toUpperCase()}）
          </p>
        ) : null}
        <div className="generation-form-grid">
          {Object.entries({
            bidderName: '投标单位名称',
            unifiedSocialCreditCode: '统一社会信用代码',
            address: '地址',
            legalRepresentative: '法定代表人',
            authorizedRepresentative: '授权代表',
            contact: '联系人',
            phone: '电话',
            email: '电子邮箱',
            projectName: '项目名称',
            sectionName: '标段名称',
            compilationDate: '编制日期'
          }).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={form[key as keyof GenerationUserForm]}
                onChange={(event) =>
                  update(key as keyof GenerationUserForm, event.currentTarget.value)
                }
                disabled={busy}
              />
            </label>
          ))}
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            <strong>操作未完成</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <button
          className="button primary"
          type="button"
          onClick={() => void createPreview()}
          disabled={busy || !file}
        >
          {busy ? '处理中…' : '识别模板并生成填充计划'}
        </button>
      </section>
      {preview ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="step-label">步骤 4</p>
              <h2>确认模板和填充动作</h2>
            </div>
            <span className="status-chip success">必须明确选择</span>
          </div>
          <div className="candidate-list">
            {preview.candidates.map((candidate) => (
              <label
                className={`candidate-card ${candidate.candidateId === candidateId ? 'selected' : ''}`}
                key={candidate.candidateId}
              >
                <input
                  type="radio"
                  name="candidate"
                  checked={candidate.candidateId === candidateId}
                  onChange={() => setCandidateId(candidate.candidateId)}
                />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>
                    {candidate.sourceType} · 置信度 {Math.round(candidate.confidence * 100)}% ·{' '}
                    {candidate.reasons.join('；')}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="fill-actions">
            <strong>将执行的动作：{preview.actions.length} 项</strong>
            {preview.actions.map((action) => (
              <div key={action.fieldId}>
                <span>{action.label}</span>
                <small>
                  {action.source} ·{' '}
                  {action.action === 'placeholder'
                    ? `占位符（${action.placeholderType}）`
                    : (action.value ?? '保持/待确认')}
                </small>
              </div>
            ))}
          </div>
          <button
            className="button primary"
            type="button"
            onClick={() => void generate()}
            disabled={busy || !output || !candidateId}
          >
            {busy ? '正在生成并验证…' : '确认并生成 DOCX 草稿'}
          </button>
        </section>
      ) : null}
      {result ? (
        <section className="panel">
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <h2>资格标草稿已生成</h2>
          <p>
            输出：{result.outputName} · 报告：{result.reportName}
          </p>
          {result.warnings.map((warning) => (
            <p className="inline-hint" key={warning}>
              {warning}
            </p>
          ))}
          <p className="safety-note compact">
            <strong>请人工校对</strong>
            <span>生成文件不是可直接投标文件，图片占位符、格式差异和固定参数都需要复核。</span>
          </p>
        </section>
      ) : null}
    </div>
  )
}

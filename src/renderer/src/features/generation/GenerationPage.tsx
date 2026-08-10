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
  const [planConfirmed, setPlanConfirmed] = useState(false)
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
      setPlanConfirmed(false)
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
  const update = (key: keyof GenerationUserForm, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setCandidateId('')
    setPlanConfirmed(false)
    setResult(null)
  }
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
      setCandidateId('')
      setPlanConfirmed(false)
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const generate = async (): Promise<void> => {
    if (!file || !output || !preview || !candidateId) return
    const selectedPlan = preview.plans.find((plan) => plan.candidateId === candidateId)
    if (!selectedPlan) return
    setBusy(true)
    setError(null)
    try {
      setResult(
        await bidSentryApi.runGeneration({
          schemaVersion: 1,
          inputId: file.inputId,
          outputDirectoryId: output.outputDirectoryId,
          previewTaskId: preview.taskId,
          candidateId,
          planId: selectedPlan.planId,
          planDigest: selectedPlan.planDigest,
          confirmed: true
        })
      )
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  const cancel = async (): Promise<void> => {
    if (!preview) return
    try {
      await bidSentryApi.cancelGeneration(preview.taskId)
    } catch (reason) {
      setError(userMessage(reason))
    }
  }
  const selectedPlan = preview?.plans.find((plan) => plan.candidateId === candidateId) ?? null
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
                  onChange={() => {
                    setCandidateId(candidate.candidateId)
                    setPlanConfirmed(false)
                  }}
                />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>
                    {candidate.sourceType} · 置信度 {Math.round(candidate.confidence * 100)}% · 范围{' '}
                    {candidate.startNodeId} → {candidate.endNodeId} ·{' '}
                    {candidate.startPage
                      ? `页码 ${candidate.startPage}${candidate.endPage && candidate.endPage !== candidate.startPage ? `–${candidate.endPage}` : ''} · `
                      : ''}
                    {candidate.sectionOutline.length
                      ? `章节：${candidate.sectionOutline.join(' / ')}`
                      : '未提取章节层级'}
                    · {candidate.reasons.join('；')}
                  </small>
                  {candidate.previewText ? <small>范围预览：{candidate.previewText}</small> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="fill-actions">
            <strong>将执行的动作：{selectedPlan?.actions.length ?? 0} 项</strong>
            {selectedPlan?.warnings.map((warning) => (
              <div className="notice warning" key={warning}>
                <span>{warning}</span>
              </div>
            ))}
            {selectedPlan?.actions.map((action) => (
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
            {selectedPlan?.unknownRequired ? (
              <div className="notice danger">
                <strong>有 {selectedPlan.unknownRequired} 项必填内容尚未识别</strong>
                <span>请补充模板中的待填写字段后重新选择文件，程序不会猜测或错填这些值。</span>
                {selectedPlan.unknownFields.map((field) => (
                  <small key={field.nodeId}>
                    {field.nodeId}：{field.text}
                  </small>
                ))}
                {selectedPlan.unresolvedFields.map((field) => (
                  <small key={field.field}>{field.label}：未找到明确字段位置</small>
                ))}
              </div>
            ) : null}
            {selectedPlan &&
            selectedPlan.unresolvedFields.length > 0 &&
            !selectedPlan.unknownRequired ? (
              <div className="notice warning">
                <strong>有 {selectedPlan.unresolvedFields.length} 项表单值未找到明确字段</strong>
                <span>这些值不会写入相似位置，请确认模板是否需要后再人工补充。</span>
                {selectedPlan.unresolvedFields.map((field) => (
                  <small key={field.field}>{field.label}：未填充</small>
                ))}
              </div>
            ) : null}
          </div>
          <label className="review-consent">
            <input
              type="checkbox"
              checked={planConfirmed}
              onChange={(event) => setPlanConfirmed(event.currentTarget.checked)}
              disabled={busy || !selectedPlan || selectedPlan.unknownRequired > 0}
            />
            <span>
              <strong>我已确认模板范围和填充计划</strong>
              <small>固定值来自招标证据，未知项不会猜测；生成 DOCX 后仍需人工复核。</small>
            </span>
          </label>
          <div className="button-group">
            <button
              className="button primary"
              type="button"
              onClick={() => void generate()}
              disabled={
                busy ||
                !output ||
                !candidateId ||
                !selectedPlan ||
                !planConfirmed ||
                selectedPlan.unknownRequired > 0
              }
            >
              {busy ? '正在生成并验证…' : '确认并生成 DOCX 草稿'}
            </button>
            {busy && preview ? (
              <button className="button secondary" type="button" onClick={() => void cancel()}>
                取消生成
              </button>
            ) : null}
          </div>
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
          <div className="button-group">
            {result.files.map((file) => (
              <button
                className="button secondary"
                type="button"
                key={file.fileId}
                onClick={() => void bidSentryApi.showResultInFolder(file.fileId)}
              >
                在文件夹中显示{file.displayName}
              </button>
            ))}
          </div>
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

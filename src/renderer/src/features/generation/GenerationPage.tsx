import type {
  FieldAction,
  GenerationExtraField,
  GenerationUserForm,
  SuggestedField,
  TemplateCandidate
} from '../../../../shared/contracts'
import { IconDocSpark, IconFolder } from '../../components/icons'
import { Notice, Stepper, formatBytes } from '../../components/ui'
import { useGenerationFlow, type GenerationFlow } from './useGenerationFlow'

const STEPS = [
  { key: 'file', label: '选择招标文件' },
  { key: 'template', label: '确认模板' },
  { key: 'form', label: '填写信息' },
  { key: 'plan', label: '确认计划' },
  { key: 'result', label: '生成结果' }
] as const

const PROFILE_FIELDS: ReadonlyArray<{
  key: keyof GenerationUserForm
  label: string
  span2?: boolean
  placeholder?: string
}> = [
  { key: 'bidderName', label: '投标单位名称', span2: true, placeholder: '与营业执照一致的全称' },
  { key: 'unifiedSocialCreditCode', label: '统一社会信用代码' },
  { key: 'legalRepresentative', label: '法定代表人' },
  { key: 'authorizedRepresentative', label: '授权代表' },
  { key: 'contact', label: '联系人' },
  { key: 'phone', label: '联系电话' },
  { key: 'email', label: '电子邮箱' },
  { key: 'address', label: '地址', span2: true }
]

const PROJECT_FIELDS: ReadonlyArray<{ key: keyof GenerationUserForm; label: string }> = [
  { key: 'projectName', label: '项目名称' },
  { key: 'sectionName', label: '标段名称' },
  { key: 'compilationDate', label: '编制日期' }
]

const SOURCE_META: Readonly<
  Record<FieldAction['source'], { title: string; tone: string; empty: string }>
> = {
  'tender-fixed': { title: '固定值 · 来自招标文件证据', tone: 'badge-success', empty: '' },
  'user-form': { title: '表单填写值', tone: 'badge-primary', empty: '' },
  placeholder: { title: '占位符 · 需人工替换', tone: 'badge-warning', empty: '' },
  unknown: { title: '未解决项', tone: 'badge-danger', empty: '' }
}

const SOURCE_ORDER: readonly FieldAction['source'][] = [
  'tender-fixed',
  'user-form',
  'placeholder',
  'unknown'
]

const PLACEHOLDER_LABELS: Readonly<Record<string, string>> = {
  image: '图片',
  certificate: '证照',
  signature: '签字',
  stamp: '盖章',
  text: '文本'
}

export function GenerationPage(): React.JSX.Element {
  const flow = useGenerationFlow()

  return (
    <div className="card-stack" data-testid="generation-page">
      <Stepper steps={STEPS} current={flow.step - 1} />

      {flow.error ? (
        <Notice tone="danger" title="操作未完成">
          {flow.error}
        </Notice>
      ) : null}
      {flow.notice ? <Notice tone="info">{flow.notice}</Notice> : null}

      {flow.step === 1 ? <FileStep flow={flow} /> : null}
      {flow.step === 2 ? <TemplateStep flow={flow} /> : null}
      {flow.step === 3 ? <FormStep flow={flow} /> : null}
      {flow.step === 4 ? <PlanStep flow={flow} /> : null}
      {flow.step === 5 && flow.result ? <ResultStep flow={flow} /> : null}
    </div>
  )
}

function FileStep({ flow }: { flow: GenerationFlow }): React.JSX.Element {
  const analyzing = flow.busy === 'analyzing'
  return (
    <section className="card" aria-labelledby="generation-file-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="generation-file-title">
            选择招标文件
          </h2>
          <p className="card-sub">
            从招标文件中识别资格证明文件模板；分析在本机完成，配置 AI 后仅发送受限文本。
          </p>
        </div>
        <span className="badge badge-neutral">模板需人工确认</span>
      </div>

      <div className="card-stack">
        <div className="dropzone">
          <span className="dropzone-icon" aria-hidden="true">
            <IconDocSpark size={22} />
          </span>
          <div className="dropzone-text">
            <p className="dropzone-title">选择一份招标文件（DOCX / PDF）</p>
            <p className="dropzone-desc">DOCX 复用原始模板；PDF 仅做可解释的结构化重建。</p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="generation-select-file"
            onClick={() => void flow.chooseFile()}
            disabled={analyzing}
          >
            {flow.file ? '重新选择文件' : '选择招标文件'}
          </button>
        </div>

        {flow.file ? (
          <ul className="file-list" aria-label="已选择的招标文件">
            <li className="file-row">
              <span className={`file-tag file-tag-${flow.file.documentType}`}>
                {flow.file.documentType}
              </span>
              <span className="file-name" title={flow.file.displayName}>
                {flow.file.displayName}
              </span>
              <span className="file-size">{formatBytes(flow.file.size)}</span>
            </li>
          </ul>
        ) : null}

        {flow.file ? (
          <p className="output-line">
            <IconFolder />
            <span>
              输出位置：与招标文件同目录 · 将生成「
              {flow.file.displayName.replace(/\.(?:docx|pdf)$/iu, '')}_资格标草稿.docx」与 JSON 报告
            </span>
          </p>
        ) : null}

        <div className="btn-row is-between">
          <span className="btn-note">分析只读取文件，不会写入任何内容。</span>
          <div className="btn-row">
            {analyzing ? (
              <button
                className="btn btn-danger"
                type="button"
                data-testid="generation-cancel"
                onClick={() => void flow.cancelBusy()}
              >
                取消分析
              </button>
            ) : null}
            <button
              className="btn btn-primary"
              type="button"
              data-testid="generation-analyze"
              onClick={() => void flow.analyze()}
              disabled={!flow.file || analyzing}
            >
              {analyzing ? '正在分析…' : '开始分析'}
            </button>
          </div>
        </div>

        {analyzing ? (
          <p className="loading-line">
            <span className="spinner" aria-hidden="true" />
            正在解析文件结构、定位资格模板候选…
          </p>
        ) : null}
      </div>
    </section>
  )
}

function TemplateStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const analysis = flow.analysis
  if (!analysis) return null
  return (
    <section className="card" aria-labelledby="generation-template-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="generation-template-title">
            确认模板
          </h2>
          <p className="card-sub">
            核对资格要求要点，并单选要复用的模板候选；未确认模板不会填写任何内容。
          </p>
        </div>
        <span className={`badge ${analysis.extraction.aiUsed ? 'badge-primary' : 'badge-neutral'}`}>
          {analysis.extraction.aiUsed ? 'AI 辅助分析' : '本机分析'}
        </span>
      </div>

      <div className="card-stack">
        {analysis.extraction.qualificationSummary.length ? (
          <div className="preview-file">
            <strong className="card-title" style={{ fontSize: 14 }}>
              资格要求要点
            </strong>
            <ul style={{ listStyle: 'disc', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {analysis.extraction.qualificationSummary.map((item) => (
                <li key={item} className="text-sm">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {analysis.extraction.notices.map((notice) => (
          <Notice tone="info" key={notice}>
            {notice}
          </Notice>
        ))}

        <div className="choice-list" role="radiogroup" aria-label="模板候选">
          {analysis.candidates.map((candidate) => (
            <CandidateCard
              key={candidate.candidateId}
              candidate={candidate}
              checked={candidate.candidateId === flow.candidateId}
              onSelect={() => flow.selectCandidate(candidate.candidateId)}
            />
          ))}
        </div>

        <div className="btn-row is-between">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => flow.goToStep(1)}
            disabled={Boolean(flow.busy)}
          >
            上一步
          </button>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="generation-next-form"
            onClick={() => flow.goToStep(3)}
            disabled={!flow.candidateId || Boolean(flow.busy)}
          >
            确认模板，填写信息
          </button>
        </div>
      </div>
    </section>
  )
}

function CandidateCard({
  candidate,
  checked,
  onSelect
}: {
  candidate: TemplateCandidate
  checked: boolean
  onSelect(): void
}): React.JSX.Element {
  const meta: string[] = [
    candidate.sourceType === 'docx-template' ? 'DOCX 原始模板' : 'PDF 结构化重建',
    `置信度 ${Math.round(candidate.confidence * 100)}%`
  ]
  if (candidate.startPage) {
    meta.push(
      `页码 ${candidate.startPage}${
        candidate.endPage && candidate.endPage !== candidate.startPage
          ? `–${candidate.endPage}`
          : ''
      }`
    )
  }
  return (
    <label className="choice-card" data-testid="generation-candidate">
      <input
        type="radio"
        name="generation-candidate"
        checked={checked}
        onChange={onSelect}
        aria-label={candidate.title}
      />
      <span className="choice-body">
        <span className="choice-title">{candidate.title}</span>
        <span className="choice-desc">{meta.join(' · ')}</span>
        {candidate.sectionOutline.length ? (
          <span className="choice-desc">章节：{candidate.sectionOutline.join(' / ')}</span>
        ) : null}
        {candidate.reasons.length ? (
          <span className="choice-desc">依据：{candidate.reasons.join('；')}</span>
        ) : null}
        {candidate.previewText ? (
          <span className="choice-desc">预览：{candidate.previewText}</span>
        ) : null}
      </span>
    </label>
  )
}

function FormStep({ flow }: { flow: GenerationFlow }): React.JSX.Element {
  const planning = flow.busy === 'planning'
  return (
    <section className="card" aria-labelledby="generation-form-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="generation-form-title">
            填写信息
          </h2>
          <p className="card-sub">公司资料已根据「设置」中的内容预填，可按当前项目修改。</p>
        </div>
        <span className="badge badge-neutral">仅用于本次填充</span>
      </div>

      <div className="card-stack">
        <div className="form-grid">
          {PROFILE_FIELDS.map((field) => (
            <FormInput
              key={field.key}
              label={field.label}
              required={field.key === 'bidderName'}
              span2={field.span2 ?? false}
              placeholder={field.placeholder ?? ''}
              value={String(flow.form[field.key])}
              disabled={planning}
              onChange={(value) => flow.updateFormField(field.key, value)}
            />
          ))}
          {PROJECT_FIELDS.map((field) => (
            <FormInput
              key={field.key}
              label={field.label}
              required={false}
              span2={false}
              placeholder=""
              value={String(flow.form[field.key])}
              disabled={planning}
              onChange={(value) => flow.updateFormField(field.key, value)}
            />
          ))}
        </div>

        {flow.form.extraFields.length ? (
          <>
            <hr className="divider" />
            <div>
              <p className="card-title" style={{ fontSize: 14 }}>
                模板要求的其他信息
              </p>
              <p className="card-sub">由模板分析建议；留空的必填项会在计划中标记为未解决。</p>
            </div>
            <div className="form-grid">
              {flow.form.extraFields.map((field) => (
                <ExtraFieldInput
                  key={field.key}
                  field={field}
                  suggested={flow.analysis?.extraction.suggestedFields}
                  disabled={planning}
                  onChange={(value) => flow.updateExtraField(field.key, value)}
                />
              ))}
            </div>
          </>
        ) : null}

        {flow.formError ? (
          <Notice tone="danger" title="信息不完整">
            {flow.formError}
          </Notice>
        ) : null}

        <div className="btn-row is-between">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => flow.goToStep(2)}
            disabled={planning}
          >
            上一步
          </button>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="generation-plan"
            onClick={() => void flow.createPlan()}
            disabled={planning}
          >
            {planning ? '正在生成计划…' : '生成填充计划'}
          </button>
        </div>

        {planning ? (
          <p className="loading-line">
            <span className="spinner" aria-hidden="true" />
            正在把表单值与招标证据对齐到模板字段…
          </p>
        ) : null}
      </div>
    </section>
  )
}

function FormInput({
  label,
  value,
  required,
  span2,
  placeholder,
  disabled,
  onChange
}: {
  label: string
  value: string
  required: boolean
  span2: boolean
  placeholder: string
  disabled: boolean
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <label className={`field${span2 ? ' span-2' : ''}`}>
      <span className="field-label">
        {label}
        {required ? <span className="req">*</span> : null}
      </span>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function ExtraFieldInput({
  field,
  suggested,
  disabled,
  onChange
}: {
  field: GenerationExtraField
  suggested: readonly SuggestedField[] | undefined
  disabled: boolean
  onChange(value: string): void
}): React.JSX.Element {
  const suggestion = suggested?.find((item) => item.key === field.key)
  return (
    <label className="field">
      <span className="field-label">
        {field.label}
        {suggestion?.required ? <span className="req">*</span> : null}
      </span>
      <input
        className="input"
        value={field.value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {suggestion?.hint ? <span className="field-hint">{suggestion.hint}</span> : null}
    </label>
  )
}

function PlanStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const plan = flow.plan
  if (!plan) return null
  const running = flow.busy === 'running'
  const blocked = plan.unknownRequired > 0
  return (
    <section className="card" aria-labelledby="generation-plan-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="generation-plan-title">
            确认填充计划
          </h2>
          <p className="card-sub">
            共 {plan.actions.length} 项填充动作，按来源分组如下；未解决项不会被猜测填充。
          </p>
        </div>
        <span className={`badge ${blocked ? 'badge-danger' : 'badge-success'}`}>
          {blocked ? '存在未解决必填项' : '计划可执行'}
        </span>
      </div>

      <div className="card-stack">
        {SOURCE_ORDER.map((source) => {
          const actions = plan.actions.filter((action) => action.source === source)
          if (!actions.length) return null
          return (
            <div className="plan-group" key={source}>
              <div className="plan-group-head">
                <span className={`badge ${SOURCE_META[source].tone}`}>
                  {SOURCE_META[source].title}
                </span>
                <span className="muted text-sm">{actions.length} 项</span>
              </div>
              <div className="plan-rows">
                {actions.map((action) => (
                  <div className="plan-row" key={action.fieldId}>
                    <span className="plan-row-label">{action.label}</span>
                    <span className="plan-row-value">
                      <ActionValue action={action} />
                      {action.source === 'tender-fixed' && action.evidenceNodeId ? (
                        <span className="plan-row-evidence">
                          {' '}
                          · 证据节点 {action.evidenceNodeId}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {plan.warnings.map((warning) => (
          <Notice tone="warning" key={warning}>
            {warning}
          </Notice>
        ))}

        {blocked ? (
          <Notice tone="danger" title={`有 ${plan.unknownRequired} 项必填内容尚未识别`}>
            <ul>
              {plan.unknownFields.map((field) => (
                <li key={field.nodeId}>
                  {field.nodeId}：{field.text}
                </li>
              ))}
              {plan.unresolvedFields.map((field) => (
                <li key={field.field}>{field.label}：未找到明确字段位置</li>
              ))}
            </ul>
            请补充信息或调整模板后重新生成计划，程序不会猜测或错填这些值。
          </Notice>
        ) : null}

        {!blocked && plan.unresolvedFields.length > 0 ? (
          <Notice
            tone="warning"
            title={`有 ${plan.unresolvedFields.length} 项表单值未找到明确字段`}
          >
            <ul>
              {plan.unresolvedFields.map((field) => (
                <li key={field.field}>{field.label}：未填充</li>
              ))}
            </ul>
            这些值不会写入相似位置，如确需使用请人工补充。
          </Notice>
        ) : null}

        <label className="check">
          <input
            type="checkbox"
            checked={flow.planConfirmed}
            onChange={(event) => flow.setPlanConfirmed(event.currentTarget.checked)}
            disabled={running || blocked}
          />
          <span>
            <span className="check-title">我已确认填充计划</span>
            <span className="check-hint">
              固定值均来自招标文件证据；生成 DOCX 草稿后仍需人工复核图片占位符与格式。
            </span>
          </span>
        </label>

        <div className="btn-row is-between">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => flow.goToStep(3)}
            disabled={running}
          >
            上一步：修改信息
          </button>
          <div className="btn-row">
            {running ? (
              <button
                className="btn btn-danger"
                type="button"
                data-testid="generation-cancel"
                onClick={() => void flow.cancelBusy()}
              >
                取消生成
              </button>
            ) : null}
            <button
              className="btn btn-primary"
              type="button"
              data-testid="generation-run"
              onClick={() => void flow.run()}
              disabled={running || blocked || !flow.planConfirmed}
            >
              {running ? '正在生成并验证…' : '确认并生成'}
            </button>
          </div>
        </div>

        {running ? (
          <p className="loading-line">
            <span className="spinner" aria-hidden="true" />
            正在生成 DOCX 草稿并做一致性验证…
          </p>
        ) : null}
      </div>
    </section>
  )
}

function ActionValue({ action }: { action: FieldAction }): React.JSX.Element {
  if (action.source === 'placeholder') {
    return (
      <span className="badge badge-warning">
        {PLACEHOLDER_LABELS[action.placeholderType ?? 'text'] ?? '占位符'}占位符
      </span>
    )
  }
  if (action.source === 'unknown') {
    return <span className="badge badge-danger">未解决</span>
  }
  return <span className="cell-value">{action.value ?? '—'}</span>
}

function ResultStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const result = flow.result
  if (!result) return null
  return (
    <section className="card terminal-card" aria-labelledby="generation-result-title">
      <span className="terminal-icon is-success" aria-hidden="true">
        ✓
      </span>
      <h2 className="terminal-title" id="generation-result-title">
        资格标草稿已生成
      </h2>
      <p className="terminal-desc">
        输出：{result.outputName} · 报告：{result.reportName}（与招标文件同目录）
      </p>

      <div className="result-files">
        {result.files.map((file) => (
          <div className="result-file-row" key={file.fileId}>
            <span className="badge badge-neutral">
              {file.kind === 'generated-document' ? 'DOCX 草稿' : 'JSON 报告'}
            </span>
            <span className="file-name" title={file.displayName}>
              {file.displayName}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              aria-label={`在文件夹中显示 ${file.displayName}`}
              onClick={() => void showInFolder(file.fileId)}
            >
              在文件夹中显示
            </button>
          </div>
        ))}
      </div>

      {result.warnings.map((warning) => (
        <Notice tone="warning" key={warning}>
          {warning}
        </Notice>
      ))}

      <Notice tone="warning" title="请人工校对后再使用">
        生成文件不是可直接提交的最终标书：图片占位符、格式差异与固定参数都需要逐项复核。
      </Notice>

      <div className="btn-row">
        <button
          className="btn btn-primary"
          type="button"
          data-testid="generation-restart"
          onClick={flow.restart}
        >
          制作另一份
        </button>
      </div>
    </section>
  )
}

async function showInFolder(fileId: string): Promise<void> {
  const { bidSentryApi } = await import('../../api/bidSentryApi')
  await bidSentryApi.showResultInFolder(fileId).catch(() => undefined)
}

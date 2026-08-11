import { Alert, Button, Card, Checkbox, Input, Radio, Spin, Steps, Tag } from 'antd'
import { CheckCircleFilled, FolderOpenOutlined } from '@ant-design/icons'
import type {
  FieldAction,
  GenerationExtraField,
  GenerationUserForm,
  SuggestedField,
  TemplateCandidate
} from '../../../../shared/contracts'
import { bidSentryApi } from '../../api/bidSentryApi'
import { formatBytes } from '../../components/ui'
import { useGenerationFlow, type GenerationFlow } from './useGenerationFlow'

const STEPS = [
  { title: '选择招标文件' },
  { title: '确认模板' },
  { title: '填写信息' },
  { title: '确认计划' },
  { title: '生成结果' }
]

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

const SOURCE_META: Readonly<Record<FieldAction['source'], { title: string; color: string }>> = {
  'tender-fixed': { title: '固定值 · 来自招标文件证据', color: 'success' },
  'user-form': { title: '表单填写值', color: 'processing' },
  placeholder: { title: '占位符 · 需人工替换', color: 'warning' },
  unknown: { title: '未解决项', color: 'error' }
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
    <div className="stack" data-testid="generation-page">
      <Steps
        size="small"
        current={flow.step - 1}
        items={STEPS}
        style={{ maxWidth: 720 }}
        aria-label="资格标流程"
      />

      {flow.error ? (
        <Alert type="error" showIcon title="操作未完成" description={flow.error} />
      ) : null}
      {flow.notice ? <Alert type="info" showIcon title={flow.notice} /> : null}

      {flow.step === 1 ? <FileStep flow={flow} /> : null}
      {flow.step === 2 ? <TemplateStep flow={flow} /> : null}
      {flow.step === 3 ? <FormStep flow={flow} /> : null}
      {flow.step === 4 ? <PlanStep flow={flow} /> : null}
      {flow.step === 5 && flow.result ? <ResultStep flow={flow} /> : null}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 style={{ margin: 0, fontSize: 16 }}>{children}</h2>
}

function FileStep({ flow }: { flow: GenerationFlow }): React.JSX.Element {
  const analyzing = flow.busy === 'analyzing'
  return (
    <Card>
      <div className="stack">
        <div className="dropzone">
          <div className="dropzone-text">
            <p className="dropzone-title">选择一份招标文件（DOCX / PDF）</p>
            <p className="dropzone-desc">DOCX 复用原始模板；PDF 仅做可解释的结构化重建。</p>
          </div>
          <Button
            type="primary"
            data-testid="generation-select-file"
            onClick={() => void flow.chooseFile()}
            disabled={analyzing}
          >
            {flow.file ? '重新选择文件' : '选择招标文件'}
          </Button>
        </div>

        {flow.file ? (
          <ul className="file-list" aria-label="已选择的招标文件">
            <li className="file-row">
              <Tag color={flow.file.documentType === 'docx' ? 'geekblue' : 'volcano'}>
                {flow.file.documentType}
              </Tag>
              <span className="file-name" title={flow.file.displayName}>
                {flow.file.displayName}
              </span>
              <span className="file-size">{formatBytes(flow.file.size)}</span>
            </li>
          </ul>
        ) : null}

        {flow.file ? (
          <span className="muted text-sm">
            <FolderOpenOutlined style={{ marginRight: 6 }} />
            输出：与招标文件同目录，生成「
            {flow.file.displayName.replace(/\.(?:docx|pdf)$/iu, '')}
            _资格标草稿.docx」与 JSON 报告
          </span>
        ) : null}

        <div className="actions">
          {analyzing ? (
            <Button danger data-testid="generation-cancel" onClick={() => void flow.cancelBusy()}>
              取消分析
            </Button>
          ) : null}
          <Button
            type="primary"
            data-testid="generation-analyze"
            onClick={() => void flow.analyze()}
            disabled={!flow.file || analyzing}
            loading={analyzing}
          >
            {analyzing ? '正在分析…' : '开始分析'}
          </Button>
        </div>

        {analyzing ? (
          <span className="muted text-sm">
            <Spin size="small" style={{ marginRight: 8 }} />
            正在解析文件结构、定位资格模板候选…
          </span>
        ) : null}
      </div>
    </Card>
  )
}

function TemplateStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const analysis = flow.analysis
  if (!analysis) return null
  return (
    <Card
      title={<CardTitle>确认模板</CardTitle>}
      extra={
        <Tag color={analysis.extraction.aiUsed ? 'processing' : 'default'}>
          {analysis.extraction.aiUsed ? 'AI 辅助分析' : '本机分析'}
        </Tag>
      }
    >
      <div className="stack">
        {analysis.extraction.qualificationSummary.length ? (
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              资格要求要点
            </div>
            <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
              {analysis.extraction.qualificationSummary.map((item) => (
                <li key={item} className="text-sm">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {analysis.extraction.notices.map((notice) => (
          <Alert type="info" showIcon key={notice} title={notice} />
        ))}

        <Radio.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          value={flow.candidateId}
          onChange={(event) => flow.selectCandidate(String(event.target.value))}
        >
          {analysis.candidates.map((candidate) => (
            <CandidateCard key={candidate.candidateId} candidate={candidate} />
          ))}
        </Radio.Group>

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <Button onClick={() => flow.goToStep(1)} disabled={Boolean(flow.busy)}>
            上一步
          </Button>
          <Button
            type="primary"
            data-testid="generation-next-form"
            onClick={() => flow.goToStep(3)}
            disabled={!flow.candidateId || Boolean(flow.busy)}
          >
            确认模板，填写信息
          </Button>
        </div>
      </div>
    </Card>
  )
}

function CandidateCard({ candidate }: { candidate: TemplateCandidate }): React.JSX.Element {
  const meta: string[] = [
    candidate.sourceType === 'docx-template' ? 'DOCX 原始模板' : 'PDF 结构化重建',
    `置信度 ${Math.round(candidate.confidence * 100)}%`,
    `可填字段 ${candidate.fillableSlots ?? 0} 项`
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
    <Radio
      value={candidate.candidateId}
      data-testid="generation-candidate"
      className="candidate-item"
    >
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <strong>
          {candidate.title}
          {(candidate.fillableSlots ?? 0) === 0 ? (
            <Tag color="warning" style={{ marginLeft: 8 }}>
              无字段，可能仅封面
            </Tag>
          ) : null}
        </strong>
        <span className="muted text-sm">{meta.join(' · ')}</span>
        {candidate.sectionOutline.length ? (
          <span className="muted text-sm">章节：{candidate.sectionOutline.join(' / ')}</span>
        ) : null}
        {candidate.reasons.length ? (
          <span className="muted text-sm">依据：{candidate.reasons.join('；')}</span>
        ) : null}
        {candidate.previewText ? (
          <span className="muted text-sm">预览：{candidate.previewText}</span>
        ) : null}
      </span>
    </Radio>
  )
}

function FormStep({ flow }: { flow: GenerationFlow }): React.JSX.Element {
  const planning = flow.busy === 'planning'
  return (
    <Card title={<CardTitle>填写信息</CardTitle>}>
      <div className="stack">
        <div className="form-grid-2">
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
            <div className="field-label">模板要求的其他信息</div>
            <div className="form-grid-2">
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

        {flow.formError ? <Alert type="error" showIcon title={flow.formError} /> : null}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <Button onClick={() => flow.goToStep(2)} disabled={planning}>
            上一步
          </Button>
          <Button
            type="primary"
            data-testid="generation-plan"
            onClick={() => void flow.createPlan()}
            disabled={planning}
            loading={planning}
          >
            {planning ? '正在生成计划…' : '生成填充计划'}
          </Button>
        </div>
      </div>
    </Card>
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
    <label className="field-block" style={span2 ? { gridColumn: '1 / -1' } : undefined}>
      <span className="field-label">
        {label}
        {required ? ' *' : ''}
      </span>
      <Input
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
    <label className="field-block">
      <span className="field-label">
        {field.label}
        {suggestion?.required ? ' *' : ''}
      </span>
      <Input
        value={field.value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {suggestion?.hint ? <span className="muted text-sm">{suggestion.hint}</span> : null}
    </label>
  )
}

function PlanStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const plan = flow.plan
  if (!plan) return null
  const running = flow.busy === 'running'
  const blocked = plan.unknownRequired > 0
  return (
    <Card
      title={<CardTitle>确认填充计划</CardTitle>}
      extra={
        <Tag color={blocked ? 'error' : 'success'}>
          {blocked ? '存在未解决必填项' : `共 ${plan.actions.length} 项动作`}
        </Tag>
      }
    >
      <div className="stack">
        {SOURCE_ORDER.map((source) => {
          const actions = plan.actions.filter((action) => action.source === source)
          if (!actions.length) return null
          return (
            <div key={source}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Tag color={SOURCE_META[source].color}>{SOURCE_META[source].title}</Tag>
                <span className="muted text-sm">{actions.length} 项</span>
              </div>
              <ul className="file-list">
                {actions.map((action) => (
                  <li className="file-row" key={action.fieldId}>
                    <span className="file-name">{action.label}</span>
                    <span className="muted text-sm" style={{ overflowWrap: 'anywhere' }}>
                      <ActionValue action={action} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {plan.warnings.map((warning) => (
          <Alert type="warning" showIcon key={warning} title={warning} />
        ))}

        {blocked ? (
          <Alert
            type="error"
            showIcon
            title="当前模板范围内没有找到「投标单位名称」字段"
            description="请返回上一步，改选「可填字段」更多的模板候选；字段数为 0 的候选通常只是封面或分节页。程序不会猜测填充位置。"
          />
        ) : null}

        {!blocked && plan.unknownFields.length > 0 ? (
          <Alert
            type="info"
            showIcon
            title={`模板中还有 ${plan.unknownFields.length} 处空白需要生成后人工填写`}
            description="签字、盖章、日期、证照编号等空白会原样保留在草稿中，请逐项补全并复核。"
          />
        ) : null}

        {!blocked && plan.unresolvedFields.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            title={`有 ${plan.unresolvedFields.length} 项表单值未找到明确字段`}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {plan.unresolvedFields.map((field) => (
                  <li key={field.field}>{field.label}：未填充</li>
                ))}
              </ul>
            }
          />
        ) : null}

        <Checkbox
          checked={flow.planConfirmed}
          onChange={(event) => flow.setPlanConfirmed(event.target.checked)}
          disabled={running || blocked}
        >
          我已确认填充计划
        </Checkbox>

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <Button onClick={() => flow.goToStep(3)} disabled={running}>
            上一步：修改信息
          </Button>
          <div style={{ display: 'flex', gap: 10 }}>
            {running ? (
              <Button danger data-testid="generation-cancel" onClick={() => void flow.cancelBusy()}>
                取消生成
              </Button>
            ) : null}
            <Button
              type="primary"
              data-testid="generation-run"
              onClick={() => void flow.run()}
              disabled={running || blocked || !flow.planConfirmed}
              loading={running}
            >
              {running ? '正在生成并验证…' : '确认并生成'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function ActionValue({ action }: { action: FieldAction }): React.JSX.Element {
  if (action.source === 'placeholder') {
    return <Tag color="warning">{PLACEHOLDER_LABELS[action.placeholderType ?? 'text']}占位符</Tag>
  }
  if (action.source === 'unknown') {
    return <Tag color="error">未解决</Tag>
  }
  return <span style={{ userSelect: 'text' }}>{action.value ?? '—'}</span>
}

function ResultStep({ flow }: { flow: GenerationFlow }): React.JSX.Element | null {
  const result = flow.result
  if (!result) return null
  return (
    <Card>
      <div className="stack" style={{ alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircleFilled style={{ color: '#1a7a4a' }} />
          资格标草稿已生成
        </h2>
        <span className="muted text-sm">
          输出：{result.outputName} · 报告：{result.reportName}（与招标文件同目录）
        </span>

        <ul className="file-list" style={{ width: '100%' }}>
          {result.files.map((file) => (
            <li className="file-row" key={file.fileId}>
              <Tag>{file.kind === 'generated-document' ? 'DOCX 草稿' : 'JSON 报告'}</Tag>
              <span className="file-name" title={file.displayName}>
                {file.displayName}
              </span>
              <Button
                type="link"
                size="small"
                aria-label={`在文件夹中显示 ${file.displayName}`}
                onClick={() => void showInFolder(file.fileId)}
              >
                在文件夹中显示
              </Button>
            </li>
          ))}
        </ul>

        {result.warnings.map((warning) => (
          <Alert type="warning" showIcon key={warning} title={warning} />
        ))}

        <Alert
          type="warning"
          showIcon
          title="请人工校对后再使用"
          description="生成文件不是可直接提交的最终标书：图片占位符、格式差异与固定参数都需要逐项复核。"
        />

        <Button type="primary" data-testid="generation-restart" onClick={flow.restart}>
          制作另一份
        </Button>
      </div>
    </Card>
  )
}

async function showInFolder(fileId: string): Promise<void> {
  await bidSentryApi.showResultInFolder(fileId).catch(() => undefined)
}

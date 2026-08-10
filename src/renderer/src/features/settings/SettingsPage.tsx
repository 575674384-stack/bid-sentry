import { useState, type FormEvent } from 'react'
import { Alert, Button, Card, Input, Radio, Spin, Switch, Typography } from 'antd'
import {
  AiSettingsUpdateSchema,
  DEFAULT_OUTPUT_SUFFIX,
  type AiSettings,
  type AiSettingsUpdate,
  type CompanyProfile
} from '../../../../shared/contracts'
import { useSettings, type SettingsController } from './useSettings'
import { UpdatePanel } from '../updates/UpdateStatus'
import { bidSentryApi } from '../../api/bidSentryApi'

const EMPTY_PROFILE: CompanyProfile = {
  bidderName: '',
  unifiedSocialCreditCode: '',
  address: '',
  legalRepresentative: '',
  authorizedRepresentative: '',
  contact: '',
  phone: '',
  email: ''
}

export function SettingsPage(): React.JSX.Element {
  const controller = useSettings()

  if (controller.loading) {
    return (
      <Card>
        <Spin /> <span className="muted text-sm">正在读取本机设置…</span>
      </Card>
    )
  }

  if (!controller.settings) {
    return (
      <Alert
        type="error"
        showIcon
        title="无法读取本机设置"
        description={controller.errorMessage ?? '请重新启动应用后重试。'}
      />
    )
  }

  return (
    <SettingsForm
      key={settingsKey(controller.settings)}
      controller={controller}
      settings={controller.settings}
    />
  )
}

function SettingsForm({
  controller,
  settings
}: {
  controller: SettingsController
  settings: AiSettings
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(settings.timeoutMs / 1_000))
  const [maxConcurrency, setMaxConcurrency] = useState(String(settings.maxConcurrency))
  const [closeToTray, setCloseToTray] = useState(settings.closeToTray)
  const [checkUpdatesOnStartup, setCheckUpdatesOnStartup] = useState(settings.checkUpdatesOnStartup)
  const [outputMode, setOutputMode] = useState<'suffix' | 'overwrite'>(settings.outputMode)
  const [outputSuffix, setOutputSuffix] = useState(settings.outputSuffix)
  const [profile, setProfile] = useState<CompanyProfile>({
    ...EMPTY_PROFILE,
    ...settings.companyProfile
  })
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const setProfileField = (key: keyof CompanyProfile, value: string): void => {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  const createUpdate = (): AiSettingsUpdate | null => {
    const parsed = AiSettingsUpdateSchema.safeParse({
      schemaVersion: 1,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      timeoutMs: Number(timeoutSeconds) * 1_000,
      maxConcurrency: Number(maxConcurrency),
      closeToTray,
      checkUpdatesOnStartup,
      outputMode,
      outputSuffix: outputSuffix.trim() || DEFAULT_OUTPUT_SUFFIX,
      companyProfile: profile,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      clearApiKey
    })
    if (!parsed.success) {
      setValidationMessage(fieldMessage(parsed.error.issues[0]?.path[0]))
      return null
    }
    setValidationMessage(null)
    return parsed.data
  }

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const update = createUpdate()
    if (!update) return
    if (await controller.save(update)) {
      setApiKey('')
      setClearApiKey(false)
    }
  }

  const testConnection = async (): Promise<void> => {
    const update = createUpdate()
    if (!update) return
    if (!apiKey.trim() && !controller.settings?.hasApiKey) {
      setValidationMessage('请先输入 API Key，或保存一个可用的 Key。')
      return
    }
    await controller.test(update)
  }

  const busy = controller.saving || controller.testing
  const persistenceLabel =
    settings.secretPersistence === 'encrypted' ? '系统加密保存' : '仅当前会话使用'

  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Card title={<h2 style={{ margin: 0, fontSize: 16 }}>连接设置</h2>}>
        <div className="stack">
          <div className="form-grid-2">
            <label className="field-block" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">Base URL</span>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
                placeholder="https://api.example.com/v1"
                required
                disabled={busy}
              />
              <span className="muted text-sm">远程接口必须使用 HTTPS，本机环回可使用 HTTP。</span>
            </label>

            <label className="field-block">
              <span className="field-label">模型名称</span>
              <Input
                value={model}
                onChange={(event) => setModel(event.currentTarget.value)}
                placeholder="gpt-5-mini"
                maxLength={200}
                required
                disabled={busy}
                spellCheck={false}
              />
            </label>

            <label className="field-block">
              <span className="field-label">超时时间（秒）</span>
              <Input
                type="number"
                value={timeoutSeconds}
                onChange={(event) => setTimeoutSeconds(event.currentTarget.value)}
                min={5}
                max={120}
                step={1}
                required
                disabled={busy}
              />
            </label>

            <label className="field-block">
              <span className="field-label">最大并发</span>
              <Radio.Group
                value={maxConcurrency}
                onChange={(event) => setMaxConcurrency(String(event.target.value))}
                disabled={busy}
                optionType="button"
                buttonStyle="solid"
                size="small"
                options={[
                  { value: '1', label: '1（推荐）' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                  { value: '4', label: '4' }
                ]}
              />
            </label>

            <label className="field-block" style={{ gridColumn: '1 / -1' }}>
              <span className="field-label">API Key</span>
              <Input.Password
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.currentTarget.value)
                  if (event.currentTarget.value) setClearApiKey(false)
                }}
                placeholder={
                  controller.settings?.hasApiKey ? '已保存；留空则保持不变' : '输入你的 API Key'
                }
                maxLength={8_192}
                disabled={busy || clearApiKey}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="muted text-sm">
                当前状态：{controller.settings?.hasApiKey ? '已保存' : '未保存'} ·{' '}
                {persistenceLabel}
              </span>
            </label>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch
              size="small"
              checked={clearApiKey}
              onChange={(checked) => {
                setClearApiKey(checked)
                if (checked) setApiKey('')
              }}
              disabled={busy || !settings.hasApiKey}
            />
            <span className="text-sm">保存时清除已保存的 API Key</span>
          </label>
        </div>
      </Card>

      <Card title={<h2 style={{ margin: 0, fontSize: 16 }}>输出</h2>}>
        <div className="stack">
          <Radio.Group
            value={outputMode}
            onChange={(event) => setOutputMode(event.target.value as 'suffix' | 'overwrite')}
            disabled={busy}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            options={[
              {
                value: 'suffix',
                label: '另存为「原文件名 + 后缀」（推荐；同名自动追加序号）'
              },
              { value: 'overwrite', label: '覆盖原文件（验证通过后原子替换，失败自动回滚）' }
            ]}
          />
          {outputMode === 'overwrite' ? (
            <Alert
              type="warning"
              showIcon
              title="覆盖后原文件不可恢复；会先备份原文件字节，任何一步失败都会自动还原。"
            />
          ) : (
            <label className="field-block" style={{ maxWidth: 320 }}>
              <span className="field-label">文件后缀</span>
              <Input
                value={outputSuffix}
                onChange={(event) => setOutputSuffix(event.currentTarget.value)}
                placeholder={DEFAULT_OUTPUT_SUFFIX}
                maxLength={50}
                disabled={busy}
                spellCheck={false}
              />
              <span className="muted text-sm">
                例如 `投标文件.docx` → `投标文件{DEFAULT_OUTPUT_SUFFIX}.docx`
              </span>
            </label>
          )}
          <span className="muted text-sm">清洗结果始终保存在原文件所在目录。</span>
        </div>
      </Card>

      <Card title={<h2 style={{ margin: 0, fontSize: 16 }}>公司资料</h2>}>
        <div className="form-grid-2">
          <ProfileInput
            label="投标单位名称"
            span2
            value={profile.bidderName}
            maxLength={300}
            disabled={busy}
            onChange={(value) => setProfileField('bidderName', value)}
          />
          <ProfileInput
            label="统一社会信用代码"
            value={profile.unifiedSocialCreditCode}
            maxLength={100}
            disabled={busy}
            onChange={(value) => setProfileField('unifiedSocialCreditCode', value)}
          />
          <ProfileInput
            label="联系电话"
            value={profile.phone}
            maxLength={100}
            disabled={busy}
            onChange={(value) => setProfileField('phone', value)}
          />
          <ProfileInput
            label="电子邮箱"
            value={profile.email}
            maxLength={200}
            disabled={busy}
            onChange={(value) => setProfileField('email', value)}
          />
          <ProfileInput
            label="法定代表人"
            value={profile.legalRepresentative}
            maxLength={100}
            disabled={busy}
            onChange={(value) => setProfileField('legalRepresentative', value)}
          />
          <ProfileInput
            label="授权代表"
            value={profile.authorizedRepresentative}
            maxLength={100}
            disabled={busy}
            onChange={(value) => setProfileField('authorizedRepresentative', value)}
          />
          <ProfileInput
            label="联系人"
            value={profile.contact}
            maxLength={100}
            disabled={busy}
            onChange={(value) => setProfileField('contact', value)}
          />
          <ProfileInput
            label="注册地址"
            span2
            value={profile.address}
            maxLength={500}
            disabled={busy}
            onChange={(value) => setProfileField('address', value)}
          />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          用于预填资格标表单，只保存在本机。
        </Typography.Text>
      </Card>

      <Card title={<h2 style={{ margin: 0, fontSize: 16 }}>桌面</h2>}>
        <div className="stack">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch size="small" checked={closeToTray} onChange={setCloseToTray} disabled={busy} />
            <span className="text-sm">关闭窗口时最小化到系统托盘</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch
              size="small"
              checked={checkUpdatesOnStartup}
              onChange={setCheckUpdatesOnStartup}
              disabled={busy}
            />
            <span className="text-sm">启动后检查 GitHub Releases 更新</span>
          </label>
        </div>
      </Card>

      <Card title={<h2 style={{ margin: 0, fontSize: 16 }}>更新与诊断</h2>}>
        <div className="stack">
          <UpdatePanel />
          <div>
            <Button type="text" onClick={() => void bidSentryApi.openDiagnosticsDirectory()}>
              打开诊断目录
            </Button>
          </div>
        </div>
      </Card>

      {validationMessage || controller.errorMessage ? (
        <Alert
          type="error"
          showIcon
          title="设置未生效"
          description={validationMessage ?? controller.errorMessage}
        />
      ) : null}

      {controller.connectionResult ? (
        <Alert
          type={controller.connectionResult.ok ? 'success' : 'warning'}
          showIcon
          title={controller.connectionResult.ok ? '连接成功' : '连接未通过'}
          description={`${controller.connectionResult.message}${
            controller.connectionResult.ok && controller.connectionResult.modelCount !== undefined
              ? ` 已读取 ${controller.connectionResult.modelCount} 个模型。`
              : ''
          }`}
        />
      ) : null}

      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <Button onClick={() => void testConnection()} disabled={busy} loading={controller.testing}>
          {controller.testing ? '正在测试…' : '测试连接'}
        </Button>
        <Button type="primary" htmlType="submit" disabled={busy} loading={controller.saving}>
          {controller.saving ? '正在保存…' : '保存设置'}
        </Button>
      </div>
    </form>
  )
}

function ProfileInput({
  label,
  value,
  maxLength,
  span2,
  disabled,
  onChange
}: {
  label: string
  value: string
  maxLength: number
  span2?: boolean
  disabled: boolean
  onChange(value: string): void
}): React.JSX.Element {
  return (
    <label className="field-block" style={span2 ? { gridColumn: '1 / -1' } : undefined}>
      <span className="field-label">{label}</span>
      <Input
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function settingsKey(settings: AiSettings): string {
  return [
    settings.baseUrl,
    settings.model,
    settings.timeoutMs,
    settings.maxConcurrency,
    settings.closeToTray,
    settings.checkUpdatesOnStartup,
    settings.outputMode,
    settings.outputSuffix,
    JSON.stringify(settings.companyProfile),
    settings.hasApiKey,
    settings.secretPersistence
  ].join('|')
}

function fieldMessage(field: PropertyKey | undefined): string {
  switch (field) {
    case 'baseUrl':
      return '请输入有效的 Base URL。'
    case 'model':
      return '请输入模型名称。'
    case 'timeoutMs':
      return '超时时间必须是 5–120 秒之间的整数。'
    case 'maxConcurrency':
      return '最大并发必须是 1–4 之间的整数。'
    case 'outputSuffix':
      return '后缀不能包含路径分隔符、特殊字符或控制字符。'
    case 'apiKey':
      return 'API Key 不能为空或超过长度限制。'
    default:
      return '请检查设置内容后重试。'
  }
}

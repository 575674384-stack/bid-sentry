import { useState, type FormEvent } from 'react'
import {
  AiSettingsUpdateSchema,
  DEFAULT_OUTPUT_SUFFIX,
  type AiSettings,
  type AiSettingsUpdate,
  type CompanyProfile
} from '../../../../shared/contracts'
import { useSettings, type SettingsController } from './useSettings'
import { UpdatePanel } from '../updates/UpdateStatus'
import { Notice } from '../../components/ui'
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
      <section className="card" aria-live="polite">
        <div className="loading-line" />
        <p className="muted text-sm">正在读取本机设置…</p>
      </section>
    )
  }

  if (!controller.settings) {
    return (
      <section className="card" role="alert">
        <Notice tone="danger" title="无法读取本机设置">
          {controller.errorMessage ?? '请重新启动应用后重试。'}
        </Notice>
      </section>
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
    <form className="settings-grid" onSubmit={(event) => void save(event)}>
      <section className="card" aria-labelledby="settings-ai-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="settings-ai-title">
              连接设置
            </h2>
            <p className="card-sub">OpenAI 兼容接口；远程必须使用 HTTPS，本机环回可使用 HTTP。</p>
          </div>
          <span className="badge badge-neutral">Key 不会回显</span>
        </div>

        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">Base URL</span>
            <input
              className="input"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
              placeholder="https://api.example.com/v1"
              required
              disabled={busy}
            />
            <span className="field-hint">远程接口必须使用 HTTPS；本机环回地址可使用 HTTP。</span>
          </label>

          <label className="field span-2">
            <span className="field-label">模型名称</span>
            <input
              className="input"
              type="text"
              value={model}
              onChange={(event) => setModel(event.currentTarget.value)}
              placeholder="gpt-5-mini"
              maxLength={200}
              required
              disabled={busy}
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span className="field-label">超时时间（秒）</span>
            <input
              className="input"
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

          <label className="field">
            <span className="field-label">最大并发</span>
            <select
              className="select"
              value={maxConcurrency}
              onChange={(event) => setMaxConcurrency(event.currentTarget.value)}
              disabled={busy}
            >
              <option value="1">1（推荐）</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>

          <label className="field span-2">
            <span className="field-label">API Key</span>
            <input
              className="input"
              type="password"
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
            <span className="field-hint">
              当前状态：{controller.settings?.hasApiKey ? '已保存' : '未保存'} · {persistenceLabel}
            </span>
          </label>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={clearApiKey}
            onChange={(event) => {
              setClearApiKey(event.currentTarget.checked)
              if (event.currentTarget.checked) setApiKey('')
            }}
            disabled={busy || !settings.hasApiKey}
          />
          <span>
            <span className="check-title">保存时清除已保存的 API Key</span>
          </span>
        </label>
      </section>

      <section className="card" aria-labelledby="settings-output-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="settings-output-title">
              输出设置
            </h2>
            <p className="card-sub">
              清洗结果始终保存在原文件所在目录；你决定是追加后缀另存，还是直接覆盖原文件。
            </p>
          </div>
          <span className="badge badge-neutral">原文件只读</span>
        </div>

        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">输出方式</span>
            <select
              className="select"
              value={outputMode}
              onChange={(event) =>
                setOutputMode(event.currentTarget.value as 'suffix' | 'overwrite')
              }
              disabled={busy}
            >
              <option value="suffix">另存为「原文件名 + 后缀」的新文件（推荐）</option>
              <option value="overwrite">覆盖原文件（验证通过后原子替换，失败会回滚）</option>
            </select>
            <span className="field-hint">
              {outputMode === 'suffix'
                ? '同名文件已存在时自动追加 (2)、(3) 序号，不会覆盖任何现有文件。'
                : '会先备份原文件字节，任何一步失败都会自动恢复原文件。'}
            </span>
          </label>

          <label className="field span-2">
            <span className="field-label">文件后缀</span>
            <input
              className="input"
              type="text"
              value={outputSuffix}
              onChange={(event) => setOutputSuffix(event.currentTarget.value)}
              placeholder={DEFAULT_OUTPUT_SUFFIX}
              maxLength={50}
              disabled={busy || outputMode === 'overwrite'}
              spellCheck={false}
            />
            <span className="field-hint">
              例如「{DEFAULT_OUTPUT_SUFFIX}」：`投标文件.docx` → `投标文件{DEFAULT_OUTPUT_SUFFIX}
              .docx`。
            </span>
          </label>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-profile-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="settings-profile-title">
              公司资料
            </h2>
            <p className="card-sub">
              用于在资格标预制作时预填表单；只保存在本机，不会写入任何输出文件。
            </p>
          </div>
          <span className="badge badge-neutral">仅本机保存</span>
        </div>

        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">投标单位名称</span>
            <input
              className="input"
              type="text"
              value={profile.bidderName}
              onChange={(event) => setProfileField('bidderName', event.currentTarget.value)}
              maxLength={300}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="field-label">统一社会信用代码</span>
            <input
              className="input"
              type="text"
              value={profile.unifiedSocialCreditCode}
              onChange={(event) =>
                setProfileField('unifiedSocialCreditCode', event.currentTarget.value)
              }
              maxLength={100}
              disabled={busy}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">联系电话</span>
            <input
              className="input"
              type="text"
              value={profile.phone}
              onChange={(event) => setProfileField('phone', event.currentTarget.value)}
              maxLength={100}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="field-label">电子邮箱</span>
            <input
              className="input"
              type="email"
              value={profile.email}
              onChange={(event) => setProfileField('email', event.currentTarget.value)}
              maxLength={200}
              disabled={busy}
            />
          </label>
          <label className="field span-2">
            <span className="field-label">注册地址</span>
            <input
              className="input"
              type="text"
              value={profile.address}
              onChange={(event) => setProfileField('address', event.currentTarget.value)}
              maxLength={500}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="field-label">法定代表人</span>
            <input
              className="input"
              type="text"
              value={profile.legalRepresentative}
              onChange={(event) =>
                setProfileField('legalRepresentative', event.currentTarget.value)
              }
              maxLength={100}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="field-label">授权代表</span>
            <input
              className="input"
              type="text"
              value={profile.authorizedRepresentative}
              onChange={(event) =>
                setProfileField('authorizedRepresentative', event.currentTarget.value)
              }
              maxLength={100}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="field-label">联系人</span>
            <input
              className="input"
              type="text"
              value={profile.contact}
              onChange={(event) => setProfileField('contact', event.currentTarget.value)}
              maxLength={100}
              disabled={busy}
            />
          </label>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-desktop-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="settings-desktop-title">
              桌面行为
            </h2>
            <p className="card-sub">应用在本机运行时的窗口与更新行为。</p>
          </div>
        </div>

        <div className="card-stack">
          <label className="switch">
            <span className="switch-text">
              <span className="check-title">关闭窗口时最小化到系统托盘</span>
              <span className="check-hint">默认关闭；托盘菜单可显示窗口、检查更新或退出。</span>
            </span>
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(event) => setCloseToTray(event.currentTarget.checked)}
              disabled={busy}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          <label className="switch">
            <span className="switch-text">
              <span className="check-title">启动后检查 GitHub Releases 更新</span>
              <span className="check-hint">只检查不自动下载；下载和安装都需要你手动确认。</span>
            </span>
            <input
              type="checkbox"
              checked={checkUpdatesOnStartup}
              onChange={(event) => setCheckUpdatesOnStartup(event.currentTarget.checked)}
              disabled={busy}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-update-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="settings-update-title">
              更新与诊断
            </h2>
            <p className="card-sub">仅访问官方 GitHub Releases；错误日志只记录脱敏阶段与编号。</p>
          </div>
        </div>
        <UpdatePanel />
        <div className="btn-row">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void bidSentryApi.openDiagnosticsDirectory()}
          >
            打开诊断目录
          </button>
        </div>
      </section>

      {validationMessage || controller.errorMessage ? (
        <Notice tone="danger" title="设置未生效">
          {validationMessage ?? controller.errorMessage}
        </Notice>
      ) : null}

      {controller.connectionResult ? (
        <Notice
          tone={controller.connectionResult.ok ? 'success' : 'warning'}
          title={controller.connectionResult.ok ? '连接成功' : '连接未通过'}
        >
          {controller.connectionResult.message}
          {controller.connectionResult.ok && controller.connectionResult.modelCount !== undefined
            ? ` 已读取 ${controller.connectionResult.modelCount} 个模型。`
            : ''}
        </Notice>
      ) : null}

      <div className="btn-row is-between">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void testConnection()}
          disabled={busy}
        >
          {controller.testing ? '正在测试…' : '测试连接'}
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {controller.saving ? '正在保存…' : '保存设置'}
        </button>
      </div>
    </form>
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

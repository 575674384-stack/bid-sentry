import { useState, type FormEvent } from 'react'
import {
  AiSettingsUpdateSchema,
  type AiSettings,
  type AiSettingsUpdate
} from '../../../../shared/contracts'
import { useSettings, type SettingsController } from './useSettings'

export function SettingsPage(): React.JSX.Element {
  const controller = useSettings()

  if (controller.loading) {
    return (
      <section className="panel settings-loading" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>正在读取本机设置…</p>
      </section>
    )
  }

  if (!controller.settings) {
    return (
      <section className="panel terminal-panel" role="alert">
        <div className="terminal-mark danger" aria-hidden="true">
          !
        </div>
        <h2>无法读取本机设置</h2>
        <p>{controller.errorMessage ?? '请重新启动应用后重试。'}</p>
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
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const createUpdate = (): AiSettingsUpdate | null => {
    const parsed = AiSettingsUpdateSchema.safeParse({
      schemaVersion: 1,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      timeoutMs: Number(timeoutSeconds) * 1_000,
      maxConcurrency: Number(maxConcurrency),
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
    <div className="settings-layout">
      <form className="panel settings-form" onSubmit={(event) => void save(event)}>
        <div className="panel-heading">
          <div>
            <p className="step-label">OpenAI 兼容接口</p>
            <h2>连接设置</h2>
          </div>
          <span className="privacy-badge">Key 不会回显</span>
        </div>

        <div className="form-grid">
          <label className="form-field full-width">
            <span>Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
              placeholder="https://api.example.com/v1"
              required
              disabled={busy}
              aria-describedby="base-url-help"
            />
            <small id="base-url-help">远程接口必须使用 HTTPS；本机环回地址可使用 HTTP。</small>
          </label>

          <label className="form-field full-width">
            <span>模型名称</span>
            <input
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

          <label className="form-field">
            <span>超时时间（秒）</span>
            <input
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

          <label className="form-field">
            <span>最大并发</span>
            <select
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

          <label className="form-field full-width">
            <span>API Key</span>
            <input
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
            <small>
              当前状态：{controller.settings?.hasApiKey ? '已保存' : '未保存'} · {persistenceLabel}
            </small>
          </label>
        </div>

        <label className="clear-key-option">
          <input
            type="checkbox"
            checked={clearApiKey}
            onChange={(event) => {
              setClearApiKey(event.currentTarget.checked)
              if (event.currentTarget.checked) setApiKey('')
            }}
            disabled={busy || !settings.hasApiKey}
          />
          <span>保存时清除已保存的 API Key</span>
        </label>

        {validationMessage || controller.errorMessage ? (
          <div className="notice danger" role="alert">
            <strong>设置未生效</strong>
            <span>{validationMessage ?? controller.errorMessage}</span>
          </div>
        ) : null}

        {controller.connectionResult ? (
          <div
            className={`notice ${controller.connectionResult.ok ? 'success' : 'warning'}`}
            role={controller.connectionResult.ok ? 'status' : 'alert'}
          >
            <strong>{controller.connectionResult.ok ? '连接成功' : '连接未通过'}</strong>
            <span>
              {controller.connectionResult.message}
              {controller.connectionResult.ok &&
              controller.connectionResult.modelCount !== undefined
                ? ` 已读取 ${controller.connectionResult.modelCount} 个模型。`
                : ''}
            </span>
          </div>
        ) : null}

        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => void testConnection()}
            disabled={busy}
          >
            {controller.testing ? '正在测试…' : '测试连接'}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {controller.saving ? '正在保存…' : '保存设置'}
          </button>
        </div>
      </form>

      <aside className="settings-aside" aria-label="AI 使用边界">
        <div className="aside-card accent">
          <span className="aside-number">M1</span>
          <h3>当前只测试连接</h3>
          <p>元数据清洗完全由本机确定性代码完成，不会把文档内容发送给 AI。</p>
        </div>
        <div className="aside-card">
          <h3>密钥边界</h3>
          <ul>
            <li>Renderer 永远读不到已保存的 Key</li>
            <li>支持系统加密时才会持久化</li>
            <li>连接失败不会记录 Key 或响应正文</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}

function settingsKey(settings: AiSettings): string {
  return [
    settings.baseUrl,
    settings.model,
    settings.timeoutMs,
    settings.maxConcurrency,
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
    case 'apiKey':
      return 'API Key 不能为空或超过长度限制。'
    default:
      return '请检查设置内容后重试。'
  }
}

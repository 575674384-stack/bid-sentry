import { useEffect, useState } from 'react'
import type { UpdateStatus as UpdateStatusValue } from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'

export function UpdateStatus(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatusValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void bidSentryApi
      .getUpdateStatus()
      .then(setStatus)
      .catch((reason: unknown) => setError(userMessage(reason)))
  }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await bidSentryApi.checkUpdates())
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await bidSentryApi.downloadUpdate())
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await bidSentryApi.installUpdate())
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const openRelease = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await bidSentryApi.openReleasePage()
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="aside-card update-card" aria-live="polite">
      <div className="update-card-heading">
        <div>
          <span className="aside-number">更新</span>
          <h3>在线更新</h3>
        </div>
        <span className={`update-dot ${status?.state === 'available' ? 'available' : ''}`} />
      </div>
      <p>仅访问官方 GitHub Releases。检查不会自动下载；下载和安装均需要你的确认。</p>
      {status?.latestVersion ? (
        <p className="update-version">最新版本：{status.latestVersion}</p>
      ) : null}
      {status?.releasePublishedAt ? (
        <p className="update-version">
          发布时间：{new Date(status.releasePublishedAt).toLocaleString()}
        </p>
      ) : null}
      {status?.packageType ? (
        <p className="update-version">
          安装包：{status.packageType === 'manual-only' ? '需手动下载' : status.packageType}
        </p>
      ) : null}
      {status?.signatureStatus === 'unsigned' ? (
        <p className="update-warning" role="note">
          当前发布包未签名；下载前请核对官方 Release 校验和，安装前请确认来源。
        </p>
      ) : null}
      {status?.message ? <p className="update-message">{status.message}</p> : null}
      {status?.releaseNotes ? (
        <pre className="update-notes" aria-label="更新说明">
          {status.releaseNotes}
        </pre>
      ) : null}
      {error ? <p className="update-error">{error}</p> : null}
      <div className="update-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => void check()}
          disabled={busy}
        >
          {busy && status?.state === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {status?.state === 'available' ? (
          <button
            className="button primary"
            type="button"
            onClick={() => void download()}
            disabled={busy}
          >
            下载更新
          </button>
        ) : null}
        {status?.state === 'downloaded' ? (
          <button
            className="button primary"
            type="button"
            onClick={() => void install()}
            disabled={busy}
          >
            打开安装程序
          </button>
        ) : null}
        <button
          className="button secondary"
          type="button"
          onClick={() => void openRelease()}
          disabled={busy}
        >
          打开官方 Release
        </button>
      </div>
    </div>
  )
}

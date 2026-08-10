import { IconInfo } from '../../components/icons'
import { Notice } from '../../components/ui'
import { updateStateText, updateStateTone, useUpdateStatus } from './useUpdateStatus'

/** Compact update indicator for the sidebar footer. Read-only. */
export function SidebarUpdateBadge(): React.JSX.Element {
  const { status } = useUpdateStatus()
  return (
    <span className="sidebar-update">
      <span className={`dot is-${updateStateTone(status)}`} aria-hidden="true" />
      <span>{updateStateText(status)}</span>
    </span>
  )
}

/** Full update status + confirmed actions, embedded in the settings page. */
export function UpdatePanel(): React.JSX.Element {
  const { status, busy, error, check, download, install, openRelease } = useUpdateStatus()

  return (
    <div className="card-stack" aria-live="polite">
      <div className="stat-row">
        <span className="stat-chip">
          <span className={`dot is-${updateStateTone(status)}`} aria-hidden="true" />
          {updateStateText(status)}
        </span>
        <span className="stat-chip">
          当前版本 <strong>v{status?.currentVersion ?? '—'}</strong>
        </span>
        {status?.latestVersion ? (
          <span className="stat-chip">
            最新版本 <strong>v{status.latestVersion}</strong>
          </span>
        ) : null}
      </div>

      <p className="muted text-sm">
        仅访问官方 GitHub Releases；检查不会自动下载，下载和安装都需要你手动确认。
        {status?.releasePublishedAt
          ? ` 发布时间：${new Date(status.releasePublishedAt).toLocaleString()}。`
          : ''}
      </p>

      {status?.signatureStatus === 'unsigned' ? (
        <Notice tone="warning" title="发布包未签名">
          下载前请核对官方 Release 页面的校验和，确认来源后再安装。
        </Notice>
      ) : null}

      {status?.message ? <p className="muted text-sm">{status.message}</p> : null}

      {status?.releaseNotes ? (
        <pre className="release-notes" aria-label="更新说明">
          {status.releaseNotes}
        </pre>
      ) : null}

      {error ? (
        <Notice tone="danger" title="更新操作未完成">
          {error}
        </Notice>
      ) : null}

      <div className="btn-row">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void check()}
          disabled={busy}
        >
          {busy && status?.state === 'checking' ? '正在检查…' : '检查更新'}
        </button>
        {status?.state === 'available' ? (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void download()}
            disabled={busy}
          >
            下载更新
          </button>
        ) : null}
        {status?.state === 'downloaded' ? (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void install()}
            disabled={busy}
          >
            安装并重启
          </button>
        ) : null}
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => void openRelease()}
          disabled={busy}
        >
          <IconInfo size={14} />
          查看 Release 页面
        </button>
      </div>
    </div>
  )
}

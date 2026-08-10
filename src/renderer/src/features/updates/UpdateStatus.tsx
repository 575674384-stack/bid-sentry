import { Button, Progress, Tag, Typography } from 'antd'
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
  const state = status?.state ?? 'idle'
  const downloading = state === 'downloading'

  return (
    <div className="stack" aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Tag color={tagColor(state)} style={{ marginInlineEnd: 0 }}>
          {updateStateText(status)}
        </Tag>
        <Typography.Text type="secondary" className="mono" style={{ fontSize: 12.5 }}>
          当前 v{status?.currentVersion ?? '—'}
          {status?.latestVersion && state !== 'not-available' ? ` → v${status.latestVersion}` : ''}
        </Typography.Text>
      </div>

      {downloading || state === 'checking' ? (
        <Progress
          {...(status?.downloadPercent !== undefined ? { percent: status.downloadPercent } : {})}
          status="active"
          strokeColor="#1f3a5f"
          size="small"
          aria-label="更新下载进度"
        />
      ) : null}

      {status?.message && state !== 'idle' ? (
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {status.message}
          {status.releasePublishedAt
            ? ` 发布于 ${new Date(status.releasePublishedAt).toLocaleDateString('zh-CN')}。`
            : ''}
        </Typography.Text>
      ) : null}

      {status?.releaseNotes && (state === 'available' || downloading || state === 'downloaded') ? (
        <pre className="release-notes" aria-label="更新说明">
          {plainReleaseNotes(status.releaseNotes)}
        </pre>
      ) : null}

      {status?.signatureStatus === 'unsigned' && state === 'available' ? (
        <Typography.Text type="warning" style={{ fontSize: 12.5 }}>
          发布包未签名：安装前请核对官方 Release 页面的 SHA256SUMS。
        </Typography.Text>
      ) : null}

      {error ? (
        <Typography.Text type="danger" style={{ fontSize: 12.5 }}>
          {error}
        </Typography.Text>
      ) : null}

      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <Button
          onClick={() => void check()}
          loading={busy && state === 'checking'}
          disabled={busy && state !== 'checking'}
        >
          检查更新
        </Button>
        {state === 'available' ? (
          <Button type="primary" onClick={() => void download()} disabled={busy}>
            下载更新
          </Button>
        ) : null}
        {state === 'downloaded' ? (
          <Button type="primary" onClick={() => void install()} disabled={busy}>
            安装并重启
          </Button>
        ) : null}
        <Button type="text" onClick={() => void openRelease()} disabled={busy}>
          查看 Release 页面
        </Button>
      </div>
    </div>
  )
}

function tagColor(state: string): string {
  switch (state) {
    case 'not-available':
      return 'success'
    case 'available':
    case 'downloading':
    case 'downloaded':
      return 'processing'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
}

/** Release notes arrive as untrusted markdown-ish text; flatten it. */
function plainReleaseNotes(notes: string): string {
  return notes
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/u, '').replace(/^\s*[-*]\s+/u, '· '))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 2_000)
}

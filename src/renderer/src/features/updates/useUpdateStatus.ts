import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'

export interface UpdateController {
  status: UpdateStatus | null
  busy: boolean
  error: string | null
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  openRelease(): Promise<void>
}

export function useUpdateStatus(): UpdateController {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    bidSentryApi
      .getUpdateStatus()
      .then((value) => {
        if (active) setStatus(value)
      })
      .catch((reason: unknown) => {
        if (active) setError(userMessage(reason))
      })
    const unsubscribe = bidSentryApi.onUpdateStatus((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const run = useCallback(async (operation: () => Promise<UpdateStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await operation())
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const check = useCallback(() => run(() => bidSentryApi.checkUpdates()), [run])
  const download = useCallback(() => run(() => bidSentryApi.downloadUpdate()), [run])
  const install = useCallback(() => run(() => bidSentryApi.installUpdate()), [run])

  const openRelease = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await bidSentryApi.openReleasePage()
    } catch (reason) {
      setError(userMessage(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, busy, error, check, download, install, openRelease }
}

/** Short human label for a state, used by the sidebar footer and settings. */
export function updateStateText(status: UpdateStatus | null): string {
  if (!status) return '更新状态未知'
  switch (status.state) {
    case 'idle':
      return '尚未检查更新'
    case 'checking':
      return '正在检查更新…'
    case 'not-available':
      return '已是最新版本'
    case 'available':
      return status.latestVersion ? `发现新版本 v${status.latestVersion}` : '发现新版本'
    case 'downloading':
      return '正在下载更新…'
    case 'downloaded':
      return '更新已下载，可安装'
    case 'manual-only':
      return '需手动下载安装包'
    case 'error':
      return '更新检查失败'
  }
}

export function updateStateTone(status: UpdateStatus | null): 'success' | 'primary' | 'danger' {
  if (!status) return 'success'
  switch (status.state) {
    case 'available':
    case 'downloading':
    case 'downloaded':
    case 'manual-only':
      return 'primary'
    case 'error':
      return 'danger'
    default:
      return 'success'
  }
}

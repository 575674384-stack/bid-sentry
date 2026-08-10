import { useCallback, useEffect, useState } from 'react'
import type {
  AiConnectionTestResult,
  AiSettings,
  AiSettingsUpdate
} from '../../../../shared/contracts'
import { bidSentryApi, userMessage } from '../../api/bidSentryApi'
import { notifySettingsChanged } from './settingsEvents'

export interface SettingsController {
  settings: AiSettings | null
  loading: boolean
  saving: boolean
  testing: boolean
  errorMessage: string | null
  connectionResult: AiConnectionTestResult | null
  save(update: AiSettingsUpdate): Promise<boolean>
  test(update: AiSettingsUpdate): Promise<void>
}

export function useSettings(): SettingsController {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [connectionResult, setConnectionResult] = useState<AiConnectionTestResult | null>(null)

  useEffect(() => {
    let active = true
    void bidSentryApi
      .getSettings()
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(userMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const save = useCallback(async (update: AiSettingsUpdate): Promise<boolean> => {
    setSaving(true)
    setErrorMessage(null)
    setConnectionResult(null)
    try {
      const saved = await bidSentryApi.saveSettings(update)
      setSettings(saved)
      notifySettingsChanged(saved)
      return true
    } catch (error) {
      setErrorMessage(userMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const test = useCallback(async (update: AiSettingsUpdate): Promise<void> => {
    setTesting(true)
    setErrorMessage(null)
    setConnectionResult(null)
    try {
      setConnectionResult(await bidSentryApi.testAiConnection(update))
    } catch (error) {
      setErrorMessage(userMessage(error))
    } finally {
      setTesting(false)
    }
  }, [])

  return {
    settings,
    loading,
    saving,
    testing,
    errorMessage,
    connectionResult,
    save,
    test
  }
}

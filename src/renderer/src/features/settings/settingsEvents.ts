import type { AiSettings } from '../../../../shared/contracts'

/**
 * Renderer-side settings change notification. Every page stays mounted (to
 * preserve in-flight task state), so pages that cache settings must refresh
 * them when another page saves new ones.
 */
type SettingsListener = (settings: AiSettings) => void

const listeners = new Set<SettingsListener>()

export function notifySettingsChanged(settings: AiSettings): void {
  for (const listener of listeners) listener(settings)
}

export function onSettingsChanged(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

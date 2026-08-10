import type { BrowserWindow } from 'electron'

export interface WindowControllerOptions {
  closeToTray: boolean
  requestQuit: () => void
}

/** Owns the one window's close/hide lifecycle so tray and real quit cannot race. */
export class WindowController {
  #closeToTray: boolean
  #quitting = false

  constructor(
    private readonly window: BrowserWindow,
    private readonly options: WindowControllerOptions
  ) {
    this.#closeToTray = options.closeToTray
    window.on('close', (event) => {
      if (this.#closeToTray && !this.#quitting) {
        event.preventDefault()
        window.hide()
      }
    })
  }

  get closeToTray(): boolean {
    return this.#closeToTray
  }

  setCloseToTray(enabled: boolean): void {
    this.#closeToTray = enabled
    if (!enabled && !this.window.isVisible()) this.show()
  }

  show(): void {
    if (this.window.isDestroyed()) return
    this.window.show()
    this.window.focus()
  }

  hide(): void {
    if (!this.window.isDestroyed()) this.window.hide()
  }

  realQuit(): void {
    if (this.#quitting) return
    this.#quitting = true
    this.options.requestQuit()
  }

  markQuitting(): void {
    this.#quitting = true
  }
}

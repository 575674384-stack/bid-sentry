import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'

export interface TrayControllerOptions {
  window: BrowserWindow
  onCheckUpdates: () => void
  onQuit: () => void
}

/** Small, deterministic tray menu. It never owns task or update state. */
export class TrayController {
  readonly #tray: Tray

  constructor(options: TrayControllerOptions) {
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    )
    this.#tray = new Tray(icon)
    this.#tray.setToolTip('Bid Sentry')
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 Bid Sentry', click: () => options.window.show() },
        { type: 'separator' },
        { label: '检查更新', click: options.onCheckUpdates },
        { label: '退出', click: options.onQuit }
      ])
    )
    this.#tray.on('double-click', () => options.window.show())
  }

  destroy(): void {
    this.#tray.destroy()
  }
}

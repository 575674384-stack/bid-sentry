import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerIpc, type IpcMainLike } from './ipc/registerIpc'
import { ElectronSafeStorageSecretStore } from './settings/secretStore'
import { SettingsService } from './settings/settingsService'
import { TaskManager, type ManagedWorkerProcess } from './tasks/taskManager'
import { WorkspaceJournal } from './tasks/workspaceJournal'
import { DiagnosticRecorder } from './diagnostics/diagnosticRecorder'
import { WindowController } from './app/windowController'
import { TrayController } from './app/trayController'
import { UpdateService, type NativeUpdaterLike } from './updates/updateService'
import { ReviewTaskManager } from './tasks/reviewTaskManager'
import { GenerationTaskManager } from './tasks/generationTaskManager'
import type { E2eHarness } from './e2e/e2eHarness'

declare const __BID_SENTRY_E2E_BUILD__: boolean

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))

function createWindow(onReady?: () => void): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.once('ready-to-show', () => onReady?.())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  return window
}

let disposeIpc: (() => void) | null = null
let activeTaskManager: TaskManager | null = null
let activeReviewTaskManager: ReviewTaskManager | null = null
let activeGenerationTaskManager: GenerationTaskManager | null = null
let shutdownStarted = false
let shutdownComplete = false
let activeWindowController: WindowController | null = null
let activeTrayController: TrayController | null = null

async function startApplication(): Promise<void> {
  const e2eHarness = await loadE2eHarness()
  if (e2eHarness) app.setPath('userData', e2eHarness.userDataDirectory)
  await app.whenReady()
  app.setAppUserModelId('io.github.bidsentry.desktop')
  const userDataDirectory = app.getPath('userData')
  const settingsService = new SettingsService(
    join(userDataDirectory, 'settings.v2.json'),
    new ElectronSafeStorageSecretStore(join(userDataDirectory, 'secrets.v1.bin'), safeStorage)
  )
  const initialSettings = await settingsService.getPublicSettings()
  const packageType =
    process.platform === 'linux'
      ? process.env.APPIMAGE
        ? 'appimage'
        : 'manual-only'
      : process.platform === 'win32'
        ? process.env.PORTABLE_EXECUTABLE_FILE
          ? 'manual-only'
          : 'nsis'
        : 'manual-only'
  const nativeUpdater = e2eHarness ? undefined : await loadNativeUpdater(packageType)
  const updateService = new UpdateService({
    currentVersion: app.getVersion(),
    ...(nativeUpdater ? { nativeUpdater } : {}),
    packageType,
    allowDirectDownload: !app.isPackaged,
    openDownloaded: (path) => shell.openPath(path)
  })
  const workspaceJournal = new WorkspaceJournal(
    join(userDataDirectory, 'temporary-workspaces.v1.json')
  )
  const diagnostics = new DiagnosticRecorder({
    directory: join(userDataDirectory, 'diagnostics'),
    appVersion: app.getVersion()
  })
  await workspaceJournal.recover()
  const taskManager = new TaskManager(() => createWorker(e2eHarness), {
    recordWorkspace: (workspace) => workspaceJournal.add(workspace),
    forgetWorkspace: (workspace) => workspaceJournal.remove(workspace),
    diagnostics
  })
  const reviewTaskManager = new ReviewTaskManager({
    settingsService,
    recordWorkspace: (workspace) => workspaceJournal.add(workspace),
    forgetWorkspace: (workspace) => workspaceJournal.remove(workspace)
  })
  const generationTaskManager = new GenerationTaskManager({
    recordWorkspace: (workspace) => workspaceJournal.add(workspace),
    forgetWorkspace: (workspace) => workspaceJournal.remove(workspace)
  })
  activeTaskManager = taskManager
  activeReviewTaskManager = reviewTaskManager
  activeGenerationTaskManager = generationTaskManager
  disposeIpc = registerIpc({
    ipcMain: ipcMain as unknown as IpcMainLike,
    settingsService,
    taskManager,
    appVersion: app.getVersion(),
    updateService,
    reviewTaskManager,
    generationTaskManager,
    openReleasePage: (url) => {
      if (url.startsWith('https://github.com/')) void shell.openExternal(url)
    },
    openDiagnosticsDirectory: () => {
      if (!e2eHarness) void shell.openPath(join(userDataDirectory, 'diagnostics'))
    },
    onSettingsChanged(settings) {
      activeWindowController?.setCloseToTray(settings.closeToTray ?? false)
      if (settings.closeToTray && !activeTrayController) {
        const window = BrowserWindow.getAllWindows()[0]
        if (window) {
          activeTrayController = new TrayController({
            window,
            onCheckUpdates: () => void updateService.check(),
            onQuit: () => activeWindowController?.realQuit()
          })
        }
      } else if (!settings.closeToTray && activeTrayController) {
        activeTrayController.destroy()
        activeTrayController = null
      }
    },
    async selectInputPaths() {
      if (e2eHarness) return e2eHarness.inputPaths
      const result = await dialog.showOpenDialog({
        title: '选择需要清洗的 DOCX/PDF 文件',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '支持的文档', extensions: ['docx', 'pdf'] }]
      })
      return result.canceled ? null : result.filePaths
    },
    async selectOutputDirectory() {
      if (e2eHarness) return e2eHarness.outputDirectory
      const result = await dialog.showOpenDialog({
        title: '选择输出目录',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    showResultInFolder(absolutePath) {
      if (e2eHarness) {
        e2eHarness.recordRevealedFile(absolutePath)
        return
      }
      shell.showItemInFolder(absolutePath)
    }
  })
  const window = createWindow(() => {
    if ((initialSettings.checkUpdatesOnStartup ?? true) && !e2eHarness) {
      void updateService.check()
    }
  })
  activeWindowController = new WindowController(window, {
    closeToTray: initialSettings.closeToTray ?? false,
    requestQuit: () => app.quit()
  })
  if (initialSettings.closeToTray) {
    activeTrayController = new TrayController({
      window,
      onCheckUpdates: () => void updateService.check(),
      onQuit: () => activeWindowController?.realQuit()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

async function loadNativeUpdater(
  packageType: 'appimage' | 'nsis' | 'manual-only'
): Promise<NativeUpdaterLike | undefined> {
  if (!app.isPackaged || packageType === 'manual-only') return undefined
  try {
    const { autoUpdater } = await import('electron-updater')
    return autoUpdater as unknown as NativeUpdaterLike
  } catch {
    return undefined
  }
}

function createWorker(e2eHarness: E2eHarness | null): ManagedWorkerProcess {
  const workerPath = join(currentDirectory, 'worker.js')
  if (e2eHarness) return e2eHarness.createWorker(workerPath)
  return utilityProcess.fork(workerPath, [], {
    serviceName: 'Bid Sentry Document Worker'
  }) as unknown as ManagedWorkerProcess
}

async function loadE2eHarness(): Promise<E2eHarness | null> {
  if (!__BID_SENTRY_E2E_BUILD__) return null
  const { createE2eHarness } = await import('./e2e/e2eHarness')
  return createE2eHarness(process.env)
}

void startApplication().catch(() => app.exit(1))

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  activeWindowController?.markQuitting()
  activeTrayController?.destroy()
  activeTrayController = null
  disposeIpc?.()
  disposeIpc = null
  void (activeTaskManager?.shutdown() ?? Promise.resolve()).finally(() => {
    void Promise.all([
      activeReviewTaskManager?.shutdown() ?? Promise.resolve(),
      activeGenerationTaskManager?.shutdown() ?? Promise.resolve()
    ]).finally(() => {
      activeTaskManager = null
      activeReviewTaskManager = null
      activeGenerationTaskManager = null
      shutdownComplete = true
      app.quit()
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !activeWindowController?.closeToTray) {
    app.quit()
  }
})

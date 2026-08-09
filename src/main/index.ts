import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerIpc, type IpcMainLike } from './ipc/registerIpc'
import { ElectronSafeStorageSecretStore } from './settings/secretStore'
import { SettingsService } from './settings/settingsService'
import { TaskManager, type ManagedWorkerProcess } from './tasks/taskManager'
import { WorkspaceJournal } from './tasks/workspaceJournal'
import type { E2eHarness } from './e2e/e2eHarness'

declare const __BID_SENTRY_E2E_BUILD__: boolean

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))

function createWindow(): BrowserWindow {
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
let shutdownStarted = false
let shutdownComplete = false

async function startApplication(): Promise<void> {
  const e2eHarness = await loadE2eHarness()
  if (e2eHarness) app.setPath('userData', e2eHarness.userDataDirectory)
  await app.whenReady()
  app.setAppUserModelId('io.github.bidsentry.desktop')
  const userDataDirectory = app.getPath('userData')
  const settingsService = new SettingsService(
    join(userDataDirectory, 'settings.v1.json'),
    new ElectronSafeStorageSecretStore(join(userDataDirectory, 'secrets.v1.bin'), safeStorage)
  )
  const workspaceJournal = new WorkspaceJournal(
    join(userDataDirectory, 'temporary-workspaces.v1.json')
  )
  await workspaceJournal.recover()
  const taskManager = new TaskManager(() => createWorker(e2eHarness), {
    recordWorkspace: (workspace) => workspaceJournal.add(workspace),
    forgetWorkspace: (workspace) => workspaceJournal.remove(workspace)
  })
  activeTaskManager = taskManager
  disposeIpc = registerIpc({
    ipcMain: ipcMain as unknown as IpcMainLike,
    settingsService,
    taskManager,
    appVersion: app.getVersion(),
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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
  disposeIpc?.()
  disposeIpc = null
  void (activeTaskManager?.shutdown() ?? Promise.resolve()).finally(() => {
    activeTaskManager = null
    shutdownComplete = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

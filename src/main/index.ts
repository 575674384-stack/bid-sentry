import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, utilityProcess } from 'electron'
import { is } from '@electron-toolkit/utils'
import { registerIpc, type IpcMainLike } from './ipc/registerIpc'
import { ElectronSafeStorageSecretStore } from './settings/secretStore'
import { SettingsService } from './settings/settingsService'
import { TaskManager, type ManagedWorkerProcess } from './tasks/taskManager'
import { WorkspaceJournal } from './tasks/workspaceJournal'

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
      preload: join(currentDirectory, '../preload/index.mjs'),
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

app.whenReady().then(async () => {
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
  const taskManager = new TaskManager(
    () =>
      utilityProcess.fork(join(currentDirectory, 'worker.js'), [], {
        serviceName: 'Bid Sentry Document Worker'
      }) as unknown as ManagedWorkerProcess,
    {
      recordWorkspace: (workspace) => workspaceJournal.add(workspace),
      forgetWorkspace: (rootPath) => workspaceJournal.remove(rootPath)
    }
  )
  activeTaskManager = taskManager
  disposeIpc = registerIpc({
    ipcMain: ipcMain as unknown as IpcMainLike,
    settingsService,
    taskManager,
    appVersion: app.getVersion(),
    async selectInputPaths() {
      const result = await dialog.showOpenDialog({
        title: '选择需要清洗的 DOCX/PDF 文件',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '支持的文档', extensions: ['docx', 'pdf'] }]
      })
      return result.canceled ? null : result.filePaths
    },
    async selectOutputDirectory() {
      const result = await dialog.showOpenDialog({
        title: '选择输出目录',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    showResultInFolder(absolutePath) {
      shell.showItemInFolder(absolutePath)
    }
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

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

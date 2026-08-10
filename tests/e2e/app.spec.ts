import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { DOCX_FIXTURE_VALUES, writeDocxFixture } from '../fixtures/builders/docxFixture'

interface TestApplication {
  electronApp: ElectronApplication
  page: Page
  root: string
  inputPaths: string[]
  outputDirectory: string
  revealLogPath: string
}

test('uses secure Electron preferences and keeps API keys out of the Renderer', async () => {
  const aiServer = await startSyntheticAiServer()
  const application = await launchTestApplication({ inputCount: 1 })

  try {
    const windowBoundary = await application.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Application window is missing.')
      window.setSize(1024, 720)
      const [width, height] = window.getSize()
      return { width, height }
    })
    expect(windowBoundary).toEqual({ width: 1024, height: 720 })

    const runtimeBoundary = await application.page.evaluate(() => {
      const browser = globalThis as unknown as {
        document: { documentElement: { clientWidth: number; scrollWidth: number } }
        process?: unknown
        require?: unknown
        bidSentry?: { apiVersion?: unknown }
      }
      return {
        clientWidth: browser.document.documentElement.clientWidth,
        scrollWidth: browser.document.documentElement.scrollWidth,
        hasNodeProcess: browser.process !== undefined,
        hasRequire: browser.require !== undefined,
        bridgeVersion: browser.bidSentry?.apiVersion
      }
    })
    expect(runtimeBoundary).toMatchObject({
      hasNodeProcess: false,
      hasRequire: false,
      bridgeVersion: 1
    })
    const layout = runtimeBoundary
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)

    await application.page.getByRole('button', { name: /AI 设置/ }).click()
    const baseUrl = application.page.getByLabel('Base URL')
    const model = application.page.getByLabel('模型名称')
    const apiKey = application.page.getByRole('textbox', { name: /^API Key/ })
    await baseUrl.fill(`http://127.0.0.1:${aiServer.port}/v1`)
    await model.fill('synthetic-e2e-model')
    await apiKey.fill('synthetic-e2e-key')

    await application.page.getByRole('button', { name: '测试连接' }).click()
    await expect(application.page.getByText('AI 接口连接成功。')).toBeVisible()
    await expect(application.page.getByText(/已读取 2 个模型/)).toBeVisible()

    await application.page.getByRole('button', { name: '保存设置' }).click()
    await expect(application.page.getByText(/当前状态：已保存/)).toBeVisible()
    await expect(apiKey).toHaveValue('')
    await expect(application.page.locator('body')).not.toContainText('synthetic-e2e-key')

    await application.page.getByRole('button', { name: /隐私清洗/ }).click()
    await application.page.getByRole('button', { name: /AI 设置/ }).click()
    await expect(application.page.getByRole('textbox', { name: /^API Key/ })).toHaveValue('')
  } finally {
    await closeTestApplication(application)
    await closeServer(aiServer.server)
  }
})

test('sanitizes a synthetic DOCX through the real Preload, IPC, Worker, and result flow', async () => {
  const application = await launchTestApplication({ inputCount: 1 })
  const inputPath = application.inputPaths[0]
  if (!inputPath) throw new Error('Synthetic input is missing.')
  const before = await fileIdentity(inputPath)

  try {
    await application.page.getByRole('button', { name: '选择文件' }).click()
    await expect(application.page.getByText('synthetic-bid-01.docx')).toBeVisible()
    await application.page.getByRole('button', { name: '选择输出目录' }).click()
    await expect(application.page.getByText('output')).toBeVisible()

    await application.page.getByRole('button', { name: '生成清洗预览' }).click()
    await expect(application.page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()
    await expect(application.page.locator('.metadata-table')).toContainText(
      DOCX_FIXTURE_VALUES.person
    )
    await expect(application.page.locator('.metadata-table')).toContainText('User-')
    const execute = application.page.getByRole('button', { name: '开始安全清洗' })
    await expect(execute).toBeDisabled()
    await application.page.getByRole('checkbox', { name: /我已查看修改类别/ }).check()
    await expect(execute).toBeEnabled()
    await execute.click()

    await expect(
      application.page.getByRole('heading', { name: '全部文件已通过强制验证' })
    ).toBeVisible({ timeout: 30_000 })
    await expect(application.page.getByText('原文件未被修改。')).toBeVisible()

    const outputNames = (await readdir(application.outputDirectory)).sort()
    expect(outputNames.filter((name) => name.endsWith('_sanitized.docx'))).toHaveLength(1)
    expect(outputNames.filter((name) => name.endsWith('.json'))).toHaveLength(1)
    expect(outputNames.filter((name) => name.endsWith('.html'))).toHaveLength(1)

    const reportName = outputNames.find((name) => name.endsWith('.json'))
    if (!reportName) throw new Error('JSON report is missing.')
    const reportText = await readFile(join(application.outputDirectory, reportName), 'utf8')
    expect(reportText).not.toContain(DOCX_FIXTURE_VALUES.person)
    expect(reportText).not.toContain(inputPath)

    const revealButton = application.page.getByRole('button', {
      name: /在文件夹中显示 synthetic-bid-01_sanitized\.docx/
    })
    await revealButton.click()
    await expect
      .poll(async () => readOptionalText(application.revealLogPath))
      .toContain('synthetic-bid-01_sanitized.docx')

    expect(await fileIdentity(inputPath)).toEqual(before)
  } finally {
    await closeTestApplication(application)
  }
})

test('cancels an executing task without publishing output', async () => {
  const application = await launchTestApplication({ inputCount: 2, executeDelayMs: 2_000 })

  try {
    await application.page.getByRole('button', { name: '选择文件' }).click()
    await application.page.getByRole('button', { name: '选择输出目录' }).click()
    await application.page.getByRole('button', { name: '生成清洗预览' }).click()
    await expect(application.page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()
    await application.page.getByRole('checkbox', { name: /我已查看修改类别/ }).check()
    await application.page.getByRole('button', { name: '开始安全清洗' }).click()
    await application.page.getByRole('button', { name: '取消任务' }).click()

    await expect(application.page.getByRole('heading', { name: '没有生成最终文件' })).toBeVisible()
    await expect.poll(() => readdir(application.outputDirectory)).toEqual([])
  } finally {
    await closeTestApplication(application)
  }
})

test('runs the deterministic bid review workflow and writes an evidence report', async () => {
  const application = await launchTestApplication({ inputCount: 2 })
  try {
    await application.page.getByRole('button', { name: /对照审查/ }).click()
    await application.page.getByRole('button', { name: '选择两个文件' }).click()
    await application.page.getByRole('button', { name: '选择报告目录' }).click()
    await application.page.getByLabel('确认的投标单位名称').fill('示例投标单位')
    await application.page.getByRole('button', { name: '开始对照审查' }).click()
    await expect(application.page.getByRole('heading', { name: '审查结果' })).toBeVisible({
      timeout: 30_000
    })
    await expect
      .poll(async () => readdir(application.outputDirectory))
      .toContainEqual(expect.stringMatching(/^bid-review-.*\.json$/u))
  } finally {
    await closeTestApplication(application)
  }
})

test('generates a qualification DOCX from a confirmed template candidate', async () => {
  const application = await launchTestApplication({ inputCount: 1 })
  try {
    await application.page.getByRole('button', { name: /资格标预制作/ }).click()
    await application.page.getByRole('button', { name: '选择招标文件' }).click()
    await application.page.getByRole('button', { name: '选择输出目录' }).click()
    await application.page
      .locator('.generation-page')
      .getByLabel('投标单位名称')
      .fill('示例投标单位')
    await application.page.getByRole('button', { name: '识别模板并生成填充计划' }).click()
    await expect(application.page.getByRole('heading', { name: '确认模板和填充动作' })).toBeVisible(
      { timeout: 30_000 }
    )
    await application.page.getByRole('button', { name: '确认并生成 DOCX 草稿' }).click()
    await expect(application.page.getByRole('heading', { name: '资格标草稿已生成' })).toBeVisible({
      timeout: 30_000
    })
    await expect
      .poll(async () => readdir(application.outputDirectory))
      .toContainEqual(expect.stringMatching(/资格标草稿\.docx$/u))
  } finally {
    await closeTestApplication(application)
  }
})

test('preserves an awaiting preview across navigation and releases it explicitly', async () => {
  const application = await launchTestApplication({ inputCount: 1 })

  try {
    await application.page.getByRole('button', { name: '选择文件' }).click()
    await application.page.getByRole('button', { name: '生成清洗预览' }).click()
    await expect(application.page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()

    await application.page.getByRole('button', { name: /AI 设置/ }).click()
    await expect(application.page.getByRole('heading', { name: '配置 AI 接口' })).toBeVisible()
    await application.page.getByRole('button', { name: /隐私清洗/ }).click()
    await expect(application.page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()

    await application.page.getByRole('button', { name: '放弃本次预览' }).click()
    await expect(application.page.getByRole('heading', { name: '没有生成最终文件' })).toBeVisible()
    await application.page.getByRole('button', { name: '返回文件选择' }).click()

    await application.page.getByRole('button', { name: '选择文件' }).click()
    await application.page.getByRole('button', { name: '生成清洗预览' }).click()
    await expect(application.page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()
  } finally {
    await closeTestApplication(application)
  }
})

test('launches the packaged production app without test harness', async () => {
  const packagedExecutable = process.env.BID_SENTRY_PACKAGED_APP
  test.skip(!packagedExecutable, 'Set BID_SENTRY_PACKAGED_APP after packaging the application.')
  if (!packagedExecutable) return

  const root = await mkdtemp(join(tmpdir(), 'bid-sentry-packaged-e2e-'))
  const userDataDirectory = join(root, 'user-data')
  await mkdir(userDataDirectory, { recursive: true })
  await writeFile(
    join(userDataDirectory, 'settings.v2.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      baseUrl: 'https://api.openai.com/v1',
      model: 'synthetic-e2e-model',
      timeoutMs: 15_000,
      maxConcurrency: 1,
      closeToTray: false,
      checkUpdatesOnStartup: false
    })}\n`,
    { mode: 0o600 }
  )
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({
      executablePath: resolve(packagedExecutable),
      args: [`--user-data-dir=${userDataDirectory}`],
      chromiumSandbox: false,
      env: childEnvironment({})
    })
    const page = await electronApp.firstWindow()
    await assertApplicationReady(page)

    const runtimeBoundary = await page.evaluate(() => {
      const browser = globalThis as unknown as {
        process?: unknown
        require?: unknown
        bidSentry?: { apiVersion?: unknown }
      }
      return {
        hasNodeProcess: browser.process !== undefined,
        hasRequire: browser.require !== undefined,
        bridgeVersion: browser.bidSentry?.apiVersion
      }
    })
    expect(runtimeBoundary).toEqual({
      hasNodeProcess: false,
      hasRequire: false,
      bridgeVersion: 1
    })
  } finally {
    await electronApp?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

async function launchTestApplication(options: {
  inputCount: number
  executeDelayMs?: number
}): Promise<TestApplication> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bid-sentry-e2e-')))
  const fixturesDirectory = join(root, 'fixtures')
  const outputDirectory = join(root, 'output')
  const userDataDirectory = join(root, 'user-data')
  const revealLogPath = join(root, 'revealed-files.log')
  await Promise.all([
    mkdir(fixturesDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
    mkdir(userDataDirectory, { recursive: true })
  ])

  const inputPaths = await Promise.all(
    Array.from({ length: options.inputCount }, async (_value, index) => {
      const inputPath = join(
        fixturesDirectory,
        `synthetic-bid-${String(index + 1).padStart(2, '0')}.docx`
      )
      await writeDocxFixture(inputPath)
      return inputPath
    })
  )

  let electronApp: ElectronApplication | null = null
  try {
    electronApp = await electron.launch({
      args: [resolve('out/main/index.js')],
      cwd: resolve('.'),
      chromiumSandbox: false,
      env: childEnvironment({
        BID_SENTRY_E2E: '1',
        BID_SENTRY_E2E_ROOT: root,
        BID_SENTRY_E2E_INPUTS: JSON.stringify(inputPaths),
        BID_SENTRY_E2E_OUTPUT: outputDirectory,
        BID_SENTRY_E2E_USER_DATA: userDataDirectory,
        BID_SENTRY_E2E_REVEAL_LOG: revealLogPath,
        BID_SENTRY_E2E_EXECUTE_DELAY_MS: String(options.executeDelayMs ?? 0)
      })
    })
    const page = await electronApp.firstWindow()
    await assertApplicationReady(page)
    return { electronApp, page, root, inputPaths, outputDirectory, revealLogPath }
  } catch (error) {
    await electronApp?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function assertApplicationReady(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: '清洗文档隐藏信息' })
  try {
    await expect(heading).toBeVisible()
  } catch (startupError) {
    const rendererErrors: string[] = []
    page.on('pageerror', (error) => rendererErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text())
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const bodyText = await page.locator('body').innerText()
    throw new Error(
      `Renderer startup failed at ${page.url()}; body=${JSON.stringify(bodyText)}; errors=${JSON.stringify(rendererErrors)}`,
      { cause: startupError }
    )
  }
}

async function closeTestApplication(application: TestApplication): Promise<void> {
  await application.electronApp.close().catch(() => undefined)
  await rm(application.root, { recursive: true, force: true })
}

function childEnvironment(additions: Record<string, string>): Record<string, string> {
  const inheritedNames = [
    'APPDATA',
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'HOME',
    'LANG',
    'LC_ALL',
    'LOCALAPPDATA',
    'PATH',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR'
  ]
  const inherited = Object.fromEntries(
    inheritedNames.flatMap((name) => {
      const value = process.env[name]
      return value === undefined ? [] : [[name, value]]
    })
  )
  return { ...inherited, ...additions }
}

async function fileIdentity(filePath: string): Promise<{
  sha256: string
  size: number
  mtimeMs: number
}> {
  const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)])
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs
  }
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return ''
    throw error
  }
}

async function startSyntheticAiServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    if (
      request.method !== 'GET' ||
      request.url !== '/v1/models' ||
      request.headers.authorization !== 'Bearer synthetic-e2e-key'
    ) {
      response.writeHead(401).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'synthetic-1' }, { id: 'synthetic-2' }] }))
  })
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Synthetic AI server address is unavailable.')
  }
  return { server, port: address.port }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

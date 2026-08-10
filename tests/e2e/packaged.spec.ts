import { readdir, readFile, rm, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

test('executes sanitization, review, and qualification generation in the packaged E2E build', async () => {
  const executable = process.env.BID_SENTRY_PACKAGED_E2E_APP
  test.skip(!executable, 'Set BID_SENTRY_PACKAGED_E2E_APP to the E2E package executable.')
  if (!executable) return

  const root = await mkdtemp(join(tmpdir(), 'bid-sentry-packaged-flow-'))
  const fixtures = join(root, 'fixtures')
  const output = join(root, 'output')
  const userData = join(root, 'user-data')
  const revealLog = join(root, 'revealed-files.log')
  await Promise.all([
    mkdir(fixtures, { recursive: true }),
    mkdir(output, { recursive: true }),
    mkdir(userData, { recursive: true })
  ])
  const inputs = await Promise.all(
    [1, 2].map(async (index) => {
      const path = join(fixtures, `packaged-bid-${index}.docx`)
      await writeDocxFixture(path, {
        qualificationTemplate: true,
        externalDocumentRelationship: false
      })
      return path
    })
  )

  let application: ElectronApplication | null = null
  try {
    application = await electron.launch({
      executablePath: resolve(executable),
      args: [`--user-data-dir=${userData}`],
      chromiumSandbox: false,
      env: childEnvironment({
        BID_SENTRY_E2E: '1',
        BID_SENTRY_E2E_ROOT: root,
        BID_SENTRY_E2E_INPUTS: JSON.stringify(inputs),
        BID_SENTRY_E2E_OUTPUT: output,
        BID_SENTRY_E2E_USER_DATA: userData,
        BID_SENTRY_E2E_REVEAL_LOG: revealLog
      })
    })
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '清洗文档隐藏信息' })).toBeVisible()

    await runSanitization(page, output)
    await runReview(page, output)
    await runGeneration(page)

    const names = await readdir(output)
    expect(names.some((name) => name.endsWith('_sanitized.docx'))).toBe(true)
    expect(names.some((name) => /^bid-review-.*\.json$/u.test(name))).toBe(true)
    expect(names.some((name) => name.endsWith('资格标草稿.docx'))).toBe(true)
    const generated = names.find((name) => name.endsWith('资格标草稿.docx'))
    if (generated) {
      const bytes = await readFile(join(output, generated))
      expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK')
    }
  } finally {
    await application?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

async function runSanitization(page: Page, output: string): Promise<void> {
  await page.getByRole('button', { name: /隐私清洗/ }).click()
  await page.getByRole('button', { name: '选择文件' }).click()
  await page.getByRole('button', { name: '选择输出目录' }).click()
  await page.getByRole('button', { name: '生成清洗预览' }).click()
  await expect(page.getByRole('heading', { name: '检查修改范围' })).toBeVisible()
  await page.getByRole('checkbox', { name: /我已查看修改类别/ }).check()
  await page.getByRole('button', { name: '开始安全清洗' }).click()
  await expect(page.getByRole('heading', { name: '全部文件已通过强制验证' })).toBeVisible({
    timeout: 30_000
  })
  await expect
    .poll(async () => (await readdir(output)).filter((name) => name.endsWith('_sanitized.docx')))
    .toHaveLength(2)
}

async function runReview(page: Page, output: string): Promise<void> {
  await page.getByRole('button', { name: /对照审查/ }).click()
  await page.getByRole('button', { name: '选择两个文件' }).click()
  await page.getByRole('button', { name: '选择报告目录' }).click()
  await page.getByLabel('确认的投标单位名称').fill('示例投标单位')
  await page.getByRole('button', { name: '开始对照审查' }).click()
  await expect(page.getByRole('heading', { name: '审查结果' })).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => (await readdir(output)).filter((name) => /^bid-review-.*\.json$/u.test(name)))
    .toHaveLength(1)
}

async function runGeneration(page: Page): Promise<void> {
  await page.getByRole('button', { name: /资格标预制作/ }).click()
  await page.getByRole('button', { name: '选择招标文件' }).click()
  await page.getByRole('button', { name: '选择输出目录' }).click()
  await page.locator('.generation-page').getByLabel('投标单位名称').fill('示例投标单位')
  await page.getByRole('button', { name: '识别模板并生成填充计划' }).click()
  await expect(page.getByRole('heading', { name: '确认模板和填充动作' })).toBeVisible({
    timeout: 30_000
  })
  await page.locator('.candidate-card').first().click()
  await page.getByRole('checkbox', { name: /我已确认模板范围和填充计划/ }).check()
  await page.getByRole('button', { name: '确认并生成 DOCX 草稿' }).click()
  await expect(page.getByRole('heading', { name: '资格标草稿已生成' })).toBeVisible({
    timeout: 30_000
  })
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
  return {
    ...Object.fromEntries(
      inheritedNames.flatMap((name) => {
        const value = process.env[name]
        return value === undefined ? [] : [[name, value]]
      })
    ),
    ...additions
  }
}

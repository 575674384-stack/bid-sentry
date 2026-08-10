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
  const userData = join(root, 'user-data')
  const revealLog = join(root, 'revealed-files.log')
  await Promise.all([mkdir(fixtures, { recursive: true }), mkdir(userData, { recursive: true })])
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
        BID_SENTRY_E2E_USER_DATA: userData,
        BID_SENTRY_E2E_REVEAL_LOG: revealLog
      })
    })
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '隐私清洗' })).toBeVisible()

    await runSanitization(page)
    await runReview(page)
    await runGeneration(page)

    const names = await readdir(fixtures)
    expect(names.some((name) => name.endsWith('_已清洗.docx'))).toBe(true)
    expect(names.some((name) => /^bid-review-.*\.json$/u.test(name))).toBe(true)
    expect(names.some((name) => name.endsWith('_资格标草稿.docx'))).toBe(true)
    const generated = names.find((name) => name.endsWith('_资格标草稿.docx'))
    if (generated) {
      const bytes = await readFile(join(fixtures, generated))
      expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK')
    }
  } finally {
    await application?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

async function runSanitization(page: Page): Promise<void> {
  await page.getByRole('button', { name: '隐私清洗' }).click()
  await page.getByRole('button', { name: '选择文件' }).click()
  await expect(page.getByText('packaged-bid-1.docx')).toBeVisible()
  await page.getByRole('button', { name: '生成安全预览' }).click()
  await expect(page.getByRole('heading', { name: '清洗预览' })).toBeVisible()
  await page.getByRole('checkbox', { name: /我已核对预览内容/ }).check()
  await page.getByRole('button', { name: '确认并开始清洗' }).click()
  await expect(page.getByRole('heading', { name: '清洗完成，全部文件已通过验证' })).toBeVisible({
    timeout: 30_000
  })
}

async function runReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: '对照审查' }).click()
  await page.getByRole('button', { name: '选择文件' }).click()
  await expect(
    page.getByTestId('review-page').locator('.file-row').getByText('packaged-bid-1.docx')
  ).toBeVisible()
  await page.getByTestId('review-page').getByLabel('投标单位名称').fill('示例投标单位')
  await page.getByRole('button', { name: '开始审查' }).click()
  await expect(page.getByRole('heading', { name: '审查结果' })).toBeVisible({ timeout: 30_000 })
}

async function runGeneration(page: Page): Promise<void> {
  await page.getByRole('button', { name: '资格标预制作' }).click()
  await page.getByRole('button', { name: '选择招标文件' }).click()
  const generationPage = page.getByTestId('generation-page')
  await expect(generationPage.locator('.file-row').getByText('packaged-bid-1.docx')).toBeVisible()
  await generationPage.getByRole('button', { name: '开始分析' }).click()
  await expect(page.getByRole('heading', { name: '确认模板' })).toBeVisible({ timeout: 30_000 })
  await generationPage.getByTestId('generation-candidate').first().click()
  await generationPage.getByRole('button', { name: '确认模板，填写信息' }).click()
  await expect(page.getByRole('heading', { name: '填写信息' })).toBeVisible()
  await generationPage.getByLabel('投标单位名称').fill('示例投标单位')
  await generationPage.getByRole('button', { name: '生成填充计划' }).click()
  await expect(page.getByRole('heading', { name: '确认填充计划' })).toBeVisible({
    timeout: 30_000
  })
  await page.getByRole('checkbox', { name: /我已确认填充计划/ }).check()
  await page.getByRole('button', { name: '确认并生成' }).click()
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

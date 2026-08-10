import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  AiSettingsSchema,
  AiSettingsUpdateSchema,
  type AiSettings,
  type AiSettingsUpdate
} from '../../shared/contracts/settings'
import {
  APP_SETTINGS_SCHEMA_VERSION,
  CompanyProfileSchema,
  DEFAULT_OUTPUT_SUFFIX,
  OutputModeSchema,
  OutputSuffixSchema,
  type CompanyProfile,
  type OutputMode
} from '../../shared/contracts/appSettings'
import type { SecretStore } from './secretStore'

const StoredSettingsSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(APP_SETTINGS_SCHEMA_VERSION)]),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4),
    closeToTray: z.boolean().optional(),
    checkUpdatesOnStartup: z.boolean().optional(),
    outputMode: OutputModeSchema.optional(),
    outputSuffix: OutputSuffixSchema.optional(),
    companyProfile: CompanyProfileSchema.optional()
  })
  .strict()

type StoredSettings = z.infer<typeof StoredSettingsSchema>

/** The on-disk shape after normalization: every v3 field is always present. */
interface NormalizedSettings {
  schemaVersion: typeof APP_SETTINGS_SCHEMA_VERSION
  baseUrl: string
  model: string
  timeoutMs: number
  maxConcurrency: number
  closeToTray: boolean
  checkUpdatesOnStartup: boolean
  outputMode: OutputMode
  outputSuffix: string
  companyProfile: CompanyProfile
}

const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  bidderName: '',
  unifiedSocialCreditCode: '',
  address: '',
  legalRepresentative: '',
  authorizedRepresentative: '',
  contact: '',
  phone: '',
  email: ''
}

const DEFAULT_SETTINGS: NormalizedSettings = Object.freeze({
  schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  timeoutMs: 15_000,
  maxConcurrency: 1,
  closeToTray: false,
  checkUpdatesOnStartup: true,
  outputMode: 'suffix',
  outputSuffix: DEFAULT_OUTPUT_SUFFIX,
  companyProfile: DEFAULT_COMPANY_PROFILE
})

export class SettingsService {
  constructor(
    private readonly settingsPath: string,
    private readonly secretStore: SecretStore,
    private readonly now: () => number = Date.now
  ) {}

  async getPublicSettings(): Promise<AiSettings> {
    const stored = await this.readStoredSettings()
    const apiKey = await this.secretStore.getApiKey()

    return AiSettingsSchema.parse({
      ...stored,
      schemaVersion: 1,
      hasApiKey: Boolean(apiKey),
      secretPersistence: this.secretStore.persistence
    })
  }

  async save(updateInput: AiSettingsUpdate): Promise<AiSettings> {
    const update = AiSettingsUpdateSchema.parse(updateInput)
    const stored = StoredSettingsSchema.parse({
      schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
      baseUrl: normalizeAiBaseUrl(update.baseUrl),
      model: update.model.trim(),
      timeoutMs: update.timeoutMs,
      maxConcurrency: update.maxConcurrency,
      closeToTray: update.closeToTray,
      checkUpdatesOnStartup: update.checkUpdatesOnStartup,
      outputMode: update.outputMode,
      outputSuffix: update.outputSuffix,
      companyProfile: update.companyProfile
    })

    if (update.clearApiKey) {
      await this.secretStore.clearApiKey()
    } else if (update.apiKey) {
      await this.secretStore.setApiKey(update.apiKey.trim())
    }

    await writeJsonAtomically(this.settingsPath, stored)
    return this.getPublicSettings()
  }

  async getApiKeyForUse(): Promise<string | null> {
    return this.secretStore.getApiKey()
  }

  private async readStoredSettings(): Promise<NormalizedSettings> {
    try {
      const source = await readFile(this.settingsPath, 'utf8')
      const parsed = StoredSettingsSchema.safeParse(JSON.parse(source) as unknown)
      if (parsed.success) {
        return normalizeStoredSettings(parsed.data)
      }

      await this.quarantineCorruptSettings()
      return DEFAULT_SETTINGS
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        const legacyPath = this.settingsPath.replace(/\.v2\.json$/u, '.v1.json')
        if (legacyPath !== this.settingsPath) {
          try {
            const legacy = StoredSettingsSchema.parse(
              JSON.parse(await readFile(legacyPath, 'utf8')) as unknown
            )
            const migrated = normalizeStoredSettings(legacy)
            await writeJsonAtomically(this.settingsPath, migrated)
            return migrated
          } catch {
            // A missing or corrupt legacy file falls back to safe defaults.
          }
        }
        return DEFAULT_SETTINGS
      }
      if (error instanceof SyntaxError) {
        await this.quarantineCorruptSettings()
        return DEFAULT_SETTINGS
      }
      throw new Error('无法读取应用设置。', { cause: error })
    }
  }

  private async quarantineCorruptSettings(): Promise<void> {
    const quarantinedPath = `${this.settingsPath}.corrupt-${this.now()}-${randomUUID()}.json`
    try {
      await rename(this.settingsPath, quarantinedPath)
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        throw new Error('无法隔离损坏的应用设置。', { cause: error })
      }
    }
  }
}

function normalizeStoredSettings(settings: StoredSettings): NormalizedSettings {
  return {
    schemaVersion: APP_SETTINGS_SCHEMA_VERSION,
    baseUrl: settings.baseUrl,
    model: settings.model,
    timeoutMs: settings.timeoutMs,
    maxConcurrency: settings.maxConcurrency,
    closeToTray: settings.closeToTray ?? false,
    checkUpdatesOnStartup: settings.checkUpdatesOnStartup ?? true,
    outputMode: settings.outputMode ?? 'suffix',
    outputSuffix: settings.outputSuffix ?? DEFAULT_OUTPUT_SUFFIX,
    companyProfile: normalizeCompanyProfile(settings.companyProfile)
  }
}

function normalizeCompanyProfile(profile: CompanyProfile | undefined): CompanyProfile {
  return { ...DEFAULT_COMPANY_PROFILE, ...profile }
}

export function normalizeAiBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.username || url.password) {
    throw new Error('AI Base URL 不能包含用户名或密码。')
  }
  if (url.search || url.hash) {
    throw new Error('AI Base URL 不能包含查询参数或片段。')
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('AI Base URL 必须使用 HTTPS；只有本机环回地址可以使用 HTTP。')
  }

  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.toString().replace(/\/$/u, '')
}

async function writeJsonAtomically(filePath: string, value: StoredSettings): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporaryPath, filePath)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

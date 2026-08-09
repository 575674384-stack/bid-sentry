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
import type { SecretStore } from './secretStore'

const StoredSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseUrl: z.string().url().max(2_048),
    model: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(120_000),
    maxConcurrency: z.number().int().min(1).max(4)
  })
  .strict()

type StoredSettings = z.infer<typeof StoredSettingsSchema>

const DEFAULT_SETTINGS: StoredSettings = Object.freeze({
  schemaVersion: 1,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  timeoutMs: 15_000,
  maxConcurrency: 1
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
      hasApiKey: Boolean(apiKey),
      secretPersistence: this.secretStore.persistence
    })
  }

  async save(updateInput: AiSettingsUpdate): Promise<AiSettings> {
    const update = AiSettingsUpdateSchema.parse(updateInput)
    const stored = StoredSettingsSchema.parse({
      schemaVersion: 1,
      baseUrl: normalizeAiBaseUrl(update.baseUrl),
      model: update.model.trim(),
      timeoutMs: update.timeoutMs,
      maxConcurrency: update.maxConcurrency
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

  private async readStoredSettings(): Promise<StoredSettings> {
    try {
      const source = await readFile(this.settingsPath, 'utf8')
      const parsed = StoredSettingsSchema.safeParse(JSON.parse(source) as unknown)
      if (parsed.success) {
        return parsed.data
      }

      await this.quarantineCorruptSettings()
      return DEFAULT_SETTINGS
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
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

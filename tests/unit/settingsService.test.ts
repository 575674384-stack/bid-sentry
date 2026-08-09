import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ElectronSafeStorageSecretStore,
  MemorySecretStore,
  type SafeStorageAdapter
} from '../../src/main/settings/secretStore'
import { SettingsService, normalizeAiBaseUrl } from '../../src/main/settings/settingsService'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-settings-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function fakeSafeStorage(available: boolean): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/u, '')
  }
}

function settingsUpdate(apiKey?: string) {
  return {
    schemaVersion: 1 as const,
    baseUrl: 'https://api.example.com/v1/',
    model: 'example-model',
    timeoutMs: 15_000,
    maxConcurrency: 2,
    ...(apiKey ? { apiKey } : {}),
    clearApiKey: false
  }
}

describe('SettingsService', () => {
  it('persists normal settings and encrypts the API key separately', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'settings.v1.json')
    const secretPath = join(directory, 'secrets.v1.bin')
    const secretStore = new ElectronSafeStorageSecretStore(secretPath, fakeSafeStorage(true))
    const service = new SettingsService(settingsPath, secretStore)

    const publicSettings = await service.save(settingsUpdate('top-secret-key'))
    const settingsSource = await readFile(settingsPath, 'utf8')
    const encryptedSource = await readFile(secretPath, 'utf8')

    expect(publicSettings).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      hasApiKey: true,
      secretPersistence: 'encrypted'
    })
    expect('apiKey' in publicSettings).toBe(false)
    expect(settingsSource).not.toContain('top-secret-key')
    expect(encryptedSource).not.toBe('top-secret-key')
    expect(await service.getApiKeyForUse()).toBe('top-secret-key')
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
    expect((await stat(secretPath)).mode & 0o777).toBe(0o600)
  })

  it('uses session-only storage when encryption is unavailable', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'settings.v1.json')
    const secretPath = join(directory, 'secrets.v1.bin')
    const secretStore = new ElectronSafeStorageSecretStore(secretPath, fakeSafeStorage(false))
    const service = new SettingsService(settingsPath, secretStore)

    const publicSettings = await service.save(settingsUpdate('session-key'))

    expect(publicSettings.secretPersistence).toBe('session')
    expect(await service.getApiKeyForUse()).toBe('session-key')
    expect(await readdir(directory)).not.toContain('secrets.v1.bin')
  })

  it('quarantines malformed settings and returns safe defaults', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'settings.v1.json')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(settingsPath, '{broken', 'utf8'))
    const service = new SettingsService(settingsPath, new MemorySecretStore(), () => 1234)

    const settings = await service.getPublicSettings()
    const files = await readdir(directory)

    expect(settings.baseUrl).toBe('https://api.openai.com/v1')
    expect(settings.hasApiKey).toBe(false)
    expect(files.some((file) => file.startsWith('settings.v1.json.corrupt-1234-'))).toBe(true)
  })

  it('clears a previously stored API key without exposing it', async () => {
    const directory = await createTemporaryDirectory()
    const secretStore = new ElectronSafeStorageSecretStore(
      join(directory, 'secrets.v1.bin'),
      fakeSafeStorage(true)
    )
    const service = new SettingsService(join(directory, 'settings.v1.json'), secretStore)
    await service.save(settingsUpdate('remove-me'))

    const cleared = await service.save({ ...settingsUpdate(), clearApiKey: true })

    expect(cleared.hasApiKey).toBe(false)
    expect(await service.getApiKeyForUse()).toBeNull()
  })
})

describe('normalizeAiBaseUrl', () => {
  it('normalizes trailing slashes and permits loopback HTTP', () => {
    expect(normalizeAiBaseUrl('https://API.EXAMPLE.COM/v1///')).toBe(
      'https://api.example.com/v1'
    )
    expect(normalizeAiBaseUrl('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1'
    )
  })

  it('rejects remote HTTP, embedded credentials, queries and fragments', () => {
    expect(() => normalizeAiBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/u)
    expect(() => normalizeAiBaseUrl('https://user:pass@api.example.com/v1')).toThrow(/用户名/u)
    expect(() => normalizeAiBaseUrl('https://api.example.com/v1?token=x')).toThrow(/查询/u)
    expect(() => normalizeAiBaseUrl('https://api.example.com/v1#fragment')).toThrow(/片段/u)
  })
})

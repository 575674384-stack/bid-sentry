import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ElectronSafeStorageSecretStore,
  MemorySecretStore,
  type SafeStorageAdapter
} from '../../src/main/settings/secretStore'
import { SettingsService, normalizeAiBaseUrl } from '../../src/main/settings/settingsService'
import { DEFAULT_OUTPUT_SUFFIX } from '../../src/shared/contracts/appSettings'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-settings-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function fakeSafeStorage(available: boolean): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/u, '')
  }
}

function emptyCompanyProfile() {
  return {
    bidderName: '',
    unifiedSocialCreditCode: '',
    address: '',
    legalRepresentative: '',
    authorizedRepresentative: '',
    contact: '',
    phone: '',
    email: ''
  }
}

function settingsUpdate(apiKey?: string) {
  return {
    schemaVersion: 1 as const,
    baseUrl: 'https://api.example.com/v1/',
    model: 'example-model',
    timeoutMs: 15_000,
    maxConcurrency: 2,
    closeToTray: false,
    checkUpdatesOnStartup: true,
    outputMode: 'suffix' as const,
    outputSuffix: DEFAULT_OUTPUT_SUFFIX,
    companyProfile: emptyCompanyProfile(),
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
    if (process.platform !== 'win32') {
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
      expect((await stat(secretPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('persists the v3 output and company profile fields with a schemaVersion 3 stamp', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'settings.v2.json')
    const service = new SettingsService(settingsPath, new MemorySecretStore())
    const companyProfile = {
      ...emptyCompanyProfile(),
      bidderName: '示例投标单位',
      unifiedSocialCreditCode: '91330000MA27X0000A',
      phone: '0571-00000000'
    }

    const saved = await service.save({
      ...settingsUpdate(),
      outputMode: 'overwrite',
      outputSuffix: '_草稿',
      companyProfile
    })
    const stored = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
    const reread = await service.getPublicSettings()

    expect(saved.outputMode).toBe('overwrite')
    expect(saved.outputSuffix).toBe('_草稿')
    expect(saved.companyProfile).toEqual(companyProfile)
    expect(stored['schemaVersion']).toBe(3)
    expect(stored['outputMode']).toBe('overwrite')
    expect(stored['outputSuffix']).toBe('_草稿')
    expect(stored['companyProfile']).toEqual(companyProfile)
    expect(reread.companyProfile).toEqual(companyProfile)
    expect(reread.outputMode).toBe('overwrite')
  })

  it('returns v3 defaults when no settings file exists', async () => {
    const directory = await createTemporaryDirectory()
    const service = new SettingsService(
      join(directory, 'settings.v2.json'),
      new MemorySecretStore()
    )

    const settings = await service.getPublicSettings()

    expect(settings.outputMode).toBe('suffix')
    expect(settings.outputSuffix).toBe(DEFAULT_OUTPUT_SUFFIX)
    expect(settings.companyProfile).toEqual(emptyCompanyProfile())
    expect(settings.closeToTray).toBe(false)
    expect(settings.checkUpdatesOnStartup).toBe(true)
  })

  it('migrates a legacy v1 settings file to v3 with safe defaults', async () => {
    const directory = await createTemporaryDirectory()
    const legacyPath = join(directory, 'settings.v1.json')
    const settingsPath = join(directory, 'settings.v2.json')
    await writeFile(
      legacyPath,
      JSON.stringify({
        schemaVersion: 1,
        baseUrl: 'https://legacy.example.com/v1',
        model: 'legacy-model',
        timeoutMs: 10_000,
        maxConcurrency: 1
      }),
      'utf8'
    )
    const service = new SettingsService(settingsPath, new MemorySecretStore())

    const settings = await service.getPublicSettings()
    const migrated = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(settings.baseUrl).toBe('https://legacy.example.com/v1')
    expect(settings.outputMode).toBe('suffix')
    expect(settings.outputSuffix).toBe(DEFAULT_OUTPUT_SUFFIX)
    expect(settings.companyProfile).toEqual(emptyCompanyProfile())
    expect(migrated['schemaVersion']).toBe(3)
    expect(migrated['outputSuffix']).toBe(DEFAULT_OUTPUT_SUFFIX)
  })

  it('reads a v2 settings file and fills the v3 fields with defaults', async () => {
    const directory = await createTemporaryDirectory()
    const settingsPath = join(directory, 'settings.v2.json')
    await writeFile(
      settingsPath,
      JSON.stringify({
        schemaVersion: 2,
        baseUrl: 'https://v2.example.com/v1',
        model: 'v2-model',
        timeoutMs: 20_000,
        maxConcurrency: 3,
        closeToTray: true,
        checkUpdatesOnStartup: false
      }),
      'utf8'
    )
    const service = new SettingsService(settingsPath, new MemorySecretStore())

    const settings = await service.getPublicSettings()

    expect(settings.baseUrl).toBe('https://v2.example.com/v1')
    expect(settings.closeToTray).toBe(true)
    expect(settings.checkUpdatesOnStartup).toBe(false)
    expect(settings.outputMode).toBe('suffix')
    expect(settings.outputSuffix).toBe(DEFAULT_OUTPUT_SUFFIX)
    expect(settings.companyProfile).toEqual(emptyCompanyProfile())
  })

  it('rejects output suffixes that could escape or corrupt the output directory', async () => {
    const directory = await createTemporaryDirectory()
    const service = new SettingsService(
      join(directory, 'settings.v2.json'),
      new MemorySecretStore()
    )

    for (const outputSuffix of ['../x', 'a/b', 'a\\b', 'a.b.', '.', '..', 'bad\u0001suffix']) {
      await expect(service.save({ ...settingsUpdate(), outputSuffix })).rejects.toThrow()
    }
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toEqual([])
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
    await writeFile(settingsPath, '{broken', 'utf8')
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
    expect(normalizeAiBaseUrl('https://API.EXAMPLE.COM/v1///')).toBe('https://api.example.com/v1')
    expect(normalizeAiBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434/v1')
  })

  it('rejects remote HTTP, embedded credentials, queries and fragments', () => {
    expect(() => normalizeAiBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/u)
    expect(() => normalizeAiBaseUrl('https://user:pass@api.example.com/v1')).toThrow(/用户名/u)
    expect(() => normalizeAiBaseUrl('https://api.example.com/v1?token=x')).toThrow(/查询/u)
    expect(() => normalizeAiBaseUrl('https://api.example.com/v1#fragment')).toThrow(/片段/u)
  })
})

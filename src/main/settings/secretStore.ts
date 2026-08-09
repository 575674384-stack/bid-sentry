import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type SecretPersistence = 'encrypted' | 'session'

export interface SecretStore {
  readonly persistence: SecretPersistence
  getApiKey(): Promise<string | null>
  setApiKey(apiKey: string): Promise<void>
  clearApiKey(): Promise<void>
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class MemorySecretStore implements SecretStore {
  readonly persistence = 'session' as const
  #apiKey: string | null = null

  async getApiKey(): Promise<string | null> {
    return this.#apiKey
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.#apiKey = apiKey
  }

  async clearApiKey(): Promise<void> {
    this.#apiKey = null
  }
}

export class ElectronSafeStorageSecretStore implements SecretStore {
  readonly #sessionStore = new MemorySecretStore()

  constructor(
    private readonly secretPath: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  get persistence(): SecretPersistence {
    return this.safeStorage.isEncryptionAvailable() ? 'encrypted' : 'session'
  }

  async getApiKey(): Promise<string | null> {
    if (this.persistence === 'session') {
      return this.#sessionStore.getApiKey()
    }

    try {
      const encrypted = await readFile(this.secretPath)
      return this.safeStorage.decryptString(encrypted)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null
      }
      throw new Error('无法读取安全密钥存储。', { cause: error })
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    if (this.persistence === 'session') {
      await this.#sessionStore.setApiKey(apiKey)
      return
    }

    const encrypted = this.safeStorage.encryptString(apiKey)
    await writeFileAtomically(this.secretPath, encrypted)
  }

  async clearApiKey(): Promise<void> {
    await this.#sessionStore.clearApiKey()
    try {
      await unlink(this.secretPath)
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        throw new Error('无法清除安全密钥存储。', { cause: error })
      }
    }
  }
}

async function writeFileAtomically(filePath: string, contents: Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)

  try {
    await handle.writeFile(contents)
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

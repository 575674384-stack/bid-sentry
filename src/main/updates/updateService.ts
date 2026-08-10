import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { UpdateStatusSchema, type UpdateStatus } from '../../shared/contracts'

const OWNER = '575674384-stack'
const REPOSITORY = 'bid-sentry'
const API_URL = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`
const RELEASE_URL = `https://github.com/${OWNER}/${REPOSITORY}/releases/latest`

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

export type UpdatePackageType = 'appimage' | 'nsis' | 'manual-only'

interface ReleaseResponse {
  tag_name?: string
  body?: string
  html_url?: string
  assets?: ReleaseAsset[]
}

export interface NativeUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{ updateInfo?: { version?: string; releaseNotes?: string | null } }>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdateServiceOptions {
  currentVersion: string
  platform?: NodeJS.Platform
  arch?: string
  packageType?: UpdatePackageType
  nativeUpdater?: NativeUpdaterLike
  allowDirectDownload?: boolean
  fetchImpl?: typeof fetch
  openDownloaded?: (path: string) => Promise<void | string> | void
}

export class UpdateService {
  readonly #currentVersion: string
  readonly #platform: NodeJS.Platform
  readonly #arch: string
  readonly #packageType: UpdatePackageType
  readonly #fetch: typeof fetch
  readonly #openDownloaded: ((path: string) => Promise<void | string> | void) | undefined
  readonly #nativeUpdater: NativeUpdaterLike | undefined
  readonly #allowDirectDownload: boolean
  #status: UpdateStatus
  #release: ReleaseResponse | null = null
  #downloadedPath: string | null = null
  #checkPromise: Promise<UpdateStatus> | null = null

  constructor(options: UpdateServiceOptions) {
    this.#currentVersion = options.currentVersion
    this.#platform = options.platform ?? process.platform
    this.#arch = options.arch ?? process.arch
    this.#packageType =
      options.packageType ??
      defaultPackageType(this.#platform, process.env.APPIMAGE, process.env.PORTABLE_EXECUTABLE_FILE)
    this.#fetch = options.fetchImpl ?? fetch
    this.#openDownloaded = options.openDownloaded
    this.#allowDirectDownload = options.allowDirectDownload ?? true
    this.#nativeUpdater = this.#packageType === 'manual-only' ? undefined : options.nativeUpdater
    if (this.#nativeUpdater) {
      this.#nativeUpdater.autoDownload = false
      this.#nativeUpdater.autoInstallOnAppQuit = false
    }
    this.#status = UpdateStatusSchema.parse({
      schemaVersion: 1,
      state: 'idle',
      currentVersion: this.#currentVersion
    })
  }

  get status(): UpdateStatus {
    return this.#status
  }

  async check(): Promise<UpdateStatus> {
    if (this.#checkPromise) return this.#checkPromise
    this.#checkPromise = this.#check().finally(() => {
      this.#checkPromise = null
    })
    return this.#checkPromise
  }

  async download(): Promise<UpdateStatus> {
    if (this.#status.state !== 'available' || (!this.#release && !this.#nativeUpdater)) {
      return this.#status
    }
    if (this.#nativeUpdater) {
      this.#set({ state: 'downloading', message: '正在下载更新…' })
      try {
        await this.#nativeUpdater.downloadUpdate()
        return this.#set({ state: 'downloaded', message: '更新已下载，请确认后重启安装。' })
      } catch {
        return this.#set({ state: 'error', message: '更新下载失败，请稍后重试。' })
      }
    }
    if (this.#packageType === 'manual-only') return this.#manualOnly()
    if (!this.#allowDirectDownload) return this.#manualOnly()
    const release = this.#release
    if (!release) return this.#status
    const releaseTag = release.tag_name ?? ''
    const asset = this.#chooseAsset(
      (release.assets ?? []).filter((candidate) => isTrustedReleaseAsset(candidate, releaseTag))
    )
    if (!asset) return this.#manualOnly()
    const checksumAsset = (release.assets ?? []).find(
      (candidate) => candidate.name === 'SHA256SUMS' && isTrustedReleaseAsset(candidate, releaseTag)
    )
    if (!checksumAsset) return this.#manualOnly()
    this.#set({ state: 'downloading', assetName: asset.name, message: '正在下载更新…' })
    let directory: string | undefined
    try {
      const manifestResponse = await this.#fetchWithTimeout(checksumAsset.browser_download_url, {
        headers: { Accept: 'text/plain', 'User-Agent': 'Bid-Sentry' },
        redirect: 'follow'
      })
      if (!manifestResponse.ok) throw new Error('update-checksum-manifest-failed')
      assertTrustedRedirect(manifestResponse)
      const manifestBytes = await readResponseBytes(manifestResponse, 1_000_000)
      const expectedHash = parseChecksumManifest(
        new TextDecoder().decode(manifestBytes),
        asset.name
      )
      if (!expectedHash) throw new Error('update-checksum-missing')

      const response = await this.#fetchWithTimeout(asset.browser_download_url, {
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'Bid-Sentry' },
        redirect: 'follow'
      })
      if (!response.ok || !response.body) throw new Error('update-download-failed')
      assertTrustedRedirect(response)
      directory = await mkdtemp(join(tmpdir(), 'bid-sentry-update-'))
      const path = join(directory, asset.name)
      const actualHash = await streamResponseToFile(response, path, 1_000_000_000)
      if (actualHash !== expectedHash) {
        await rm(directory, { recursive: true, force: true })
        directory = undefined
        throw new Error('update-checksum-mismatch')
      }
      this.#downloadedPath = path
      this.#set({
        state: 'downloaded',
        assetName: asset.name,
        downloadedPathId: randomUUID(),
        message: '更新已下载，请确认后打开安装程序。'
      })
      return this.#status
    } catch {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      return this.#set({ state: 'error', message: '更新下载失败，请稍后重试。' })
    }
  }

  async install(): Promise<UpdateStatus> {
    if (this.#status.state !== 'downloaded' || (!this.#downloadedPath && !this.#nativeUpdater)) {
      return this.#status
    }
    if (this.#nativeUpdater) {
      this.#nativeUpdater.quitAndInstall()
      return this.#status
    }
    const downloadedPath = this.#downloadedPath
    if (!downloadedPath) return this.#status
    try {
      const openError = await this.#openDownloaded?.(downloadedPath)
      if (typeof openError === 'string' && openError.length > 0) {
        return this.#set({ state: 'error', message: '无法打开更新安装程序，请手动更新。' })
      }
      return this.#status
    } finally {
      await rm(dirname(downloadedPath), { recursive: true, force: true }).catch(() => undefined)
      this.#downloadedPath = null
    }
  }

  openReleasePage(): string {
    return RELEASE_URL
  }

  async #check(): Promise<UpdateStatus> {
    this.#set({ state: 'checking', message: '正在检查 GitHub Releases…' })
    try {
      if (this.#nativeUpdater) {
        const result = await this.#nativeUpdater.checkForUpdates()
        const version = normalizeVersion(result.updateInfo?.version ?? '')
        if (!version) throw new Error('update-invalid-native-release')
        if (
          compareVersions(
            version,
            normalizeVersion(this.#currentVersion) ?? this.#currentVersion
          ) <= 0
        ) {
          return this.#set({
            state: 'not-available',
            latestVersion: version,
            releaseUrl: RELEASE_URL,
            message: '当前已经是最新版本。'
          })
        }
        this.#release = { tag_name: `v${version}`, assets: [] }
        return this.#set({
          state: 'available',
          latestVersion: version,
          releaseUrl: RELEASE_URL,
          releaseNotes: normalizeReleaseNotes(result.updateInfo?.releaseNotes),
          message: '发现新版本，请确认后下载。'
        })
      }
      const response = await this.#fetchWithTimeout(API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Bid-Sentry' },
        redirect: 'error'
      })
      if (!response.ok) throw new Error('update-check-failed')
      const release = (await response.json()) as ReleaseResponse
      const version = normalizeVersion(release.tag_name ?? '')
      if (!version) throw new Error('update-invalid-release')
      this.#release = release
      if (
        compareVersions(version, normalizeVersion(this.#currentVersion) ?? this.#currentVersion) <=
        0
      ) {
        return this.#set({
          state: 'not-available',
          latestVersion: version,
          releaseUrl: RELEASE_URL,
          message: '当前已经是最新版本。'
        })
      }
      return this.#set({
        state: 'available',
        latestVersion: version,
        releaseUrl: RELEASE_URL,
        releaseNotes: normalizeReleaseNotes(release.body),
        message: '发现新版本，请确认后下载。'
      })
    } catch {
      return this.#set({ state: 'error', message: '暂时无法检查更新；不影响本机功能。' })
    }
  }

  #chooseAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
    const releaseVersion = normalizeVersion(this.#release?.tag_name ?? '')
    if (!releaseVersion) return null
    const expectedName = expectedAssetName(
      this.#packageType,
      this.#platform,
      this.#arch,
      releaseVersion
    )
    return assets.find((asset) => asset.name === expectedName) ?? null
  }

  #manualOnly(): UpdateStatus {
    return this.#set({
      state: 'manual-only',
      releaseUrl: RELEASE_URL,
      message: '当前安装包需要打开官方 Releases 页面手动更新。'
    })
  }

  async #fetchWithTimeout(input: string | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      return await this.#fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  #set(input: Partial<UpdateStatus>): UpdateStatus {
    this.#status = UpdateStatusSchema.parse({
      ...this.#status,
      ...input,
      schemaVersion: 1,
      currentVersion: this.#currentVersion
    })
    return this.#status
  }
}

function defaultPackageType(
  platform: NodeJS.Platform,
  appImagePath: string | undefined,
  portablePath: string | undefined
): UpdatePackageType {
  if (platform === 'linux') return appImagePath ? 'appimage' : 'manual-only'
  if (platform === 'win32') return portablePath ? 'manual-only' : 'nsis'
  return 'manual-only'
}

function expectedAssetName(
  packageType: UpdatePackageType,
  platform: NodeJS.Platform,
  arch: string,
  version: string
): string | null {
  if (packageType === 'appimage' && platform === 'linux') {
    const linuxArch = arch === 'x64' ? 'x86_64' : arch
    return `bid-sentry-${version}-linux-${linuxArch}.AppImage`
  }
  if (packageType === 'nsis' && platform === 'win32') {
    const windowsArch = arch === 'x64' ? 'x64' : arch
    return `bid-sentry-setup-${version}-win-${windowsArch}.exe`
  }
  return null
}

function isTrustedReleaseAsset(asset: ReleaseAsset, tagName: string): boolean {
  try {
    const url = new URL(asset.browser_download_url)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname ===
        `/${OWNER}/${REPOSITORY}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(asset.name)}` &&
      url.search === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

function normalizeReleaseNotes(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 20_000) : undefined
}

function assertTrustedRedirect(response: Response): void {
  if (!response.url) return
  const url = new URL(response.url)
  const allowedHosts = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'github-releases.githubusercontent.com'
  ])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new Error('update-redirect-source-invalid')
  }
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('update-response-body-missing')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      total += chunk.byteLength
      if (total > limit) throw new Error('update-response-too-large')
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function streamResponseToFile(
  response: Response,
  filePath: string,
  limit: number
): Promise<string> {
  if (!response.body) throw new Error('update-response-body-missing')
  const handle = await open(filePath, 'wx', 0o700)
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      total += chunk.byteLength
      if (total > limit) throw new Error('update-response-too-large')
      hash.update(chunk)
      await handle.write(chunk)
    }
    await handle.sync()
    return hash.digest('hex')
  } finally {
    reader.releaseLock()
    await handle.close()
  }
}

function parseChecksumManifest(manifest: string, assetName: string): string | null {
  for (const line of manifest.split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/iu.exec(line.trim())
    if (match?.[2] === assetName) return match[1]!.toLowerCase()
  }
  return null
}

function normalizeVersion(value: string): string | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value.trim())
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0)
  }
  return 0
}

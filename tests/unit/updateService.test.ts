import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { UpdateService } from '../../src/main/updates/updateService'

describe('UpdateService', () => {
  it('checks a fixed GitHub release source and requires confirmation before download', async () => {
    const calls: string[] = []
    const assetBytes = new TextEncoder().encode('synthetic update bytes')
    const assetHash = createHash('sha256').update(assetBytes).digest('hex')
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      fetchImpl: (async (input) => {
        calls.push(String(input))
        if (String(input).endsWith('/SHA256SUMS')) {
          const response = new Response(`${assetHash}  bid-sentry-1.1.0-linux-x86_64.AppImage\n`)
          Object.defineProperty(response, 'url', {
            value: 'https://release-assets.githubusercontent.com/manifest'
          })
          return response
        }
        if (String(input).endsWith('.AppImage')) {
          const response = new Response(assetBytes)
          Object.defineProperty(response, 'url', {
            value: 'https://release-assets.githubusercontent.com/asset'
          })
          return response
        }
        return new Response(
          JSON.stringify({
            tag_name: 'v1.1.0',
            body: 'notes',
            html_url: 'https://github.com/575674384-stack/bid-sentry/releases/tag/v1.1.0',
            assets: [
              {
                name: 'bid-sentry-1.1.0-linux-x86_64.AppImage',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/bid-sentry-1.1.0-linux-x86_64.AppImage'
              },
              {
                name: 'SHA256SUMS',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/SHA256SUMS'
              }
            ]
          })
        )
      }) as typeof fetch
    })
    expect((await service.check()).state).toBe('available')
    expect(calls[0]).toContain('api.github.com/repos/575674384-stack/bid-sentry')
    expect((await service.download()).state).toBe('downloaded')
  })

  it('rejects an update whose release checksum does not match', async () => {
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      fetchImpl: (async (input) => {
        const url = String(input)
        if (url.endsWith('/SHA256SUMS'))
          return new Response(`${'0'.repeat(64)}  bid-sentry-1.1.0-linux-x86_64.AppImage\n`)
        if (url.endsWith('.AppImage')) return new Response('tampered')
        return new Response(
          JSON.stringify({
            tag_name: 'v1.1.0',
            assets: [
              {
                name: 'bid-sentry-1.1.0-linux-x86_64.AppImage',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/bid-sentry-1.1.0-linux-x86_64.AppImage'
              },
              {
                name: 'SHA256SUMS',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/SHA256SUMS'
              }
            ]
          })
        )
      }) as typeof fetch
    })
    await service.check()
    expect((await service.download()).state).toBe('error')
  })

  it('rejects a release asset redirected to an untrusted host', async () => {
    const assetBytes = new TextEncoder().encode('synthetic update bytes')
    const assetHash = createHash('sha256').update(assetBytes).digest('hex')
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      fetchImpl: (async (input) => {
        const url = String(input)
        if (url.endsWith('/SHA256SUMS')) {
          return new Response(`${assetHash}  bid-sentry-1.1.0-linux-x86_64.AppImage\n`)
        }
        if (url.endsWith('.AppImage')) {
          const response = new Response(assetBytes)
          Object.defineProperty(response, 'url', { value: 'https://evil.example/update' })
          return response
        }
        return new Response(
          JSON.stringify({
            tag_name: 'v1.1.0',
            assets: [
              {
                name: 'bid-sentry-1.1.0-linux-x86_64.AppImage',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/bid-sentry-1.1.0-linux-x86_64.AppImage'
              },
              {
                name: 'SHA256SUMS',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/SHA256SUMS'
              }
            ]
          })
        )
      }) as typeof fetch
    })
    await service.check()
    expect((await service.download()).state).toBe('error')
  })

  it('does not select an asset whose filename belongs to another release version', async () => {
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.1.0',
            assets: [
              {
                name: 'bid-sentry-1.0.0-linux-x86_64.AppImage',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/bid-sentry-1.0.0-linux-x86_64.AppImage'
              },
              {
                name: 'SHA256SUMS',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/SHA256SUMS'
              }
            ]
          })
        )) as typeof fetch
    })
    await service.check()
    expect((await service.download()).state).toBe('manual-only')
  })

  it('marks unsupported package types as manual-only', async () => {
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'freebsd',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ tag_name: 'v1.1.0', assets: [] }))) as typeof fetch
    })
    await service.check()
    expect((await service.download()).state).toBe('manual-only')
  })

  it('does not use a native updater for manual-only package types', async () => {
    let checked = false
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'manual-only',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ tag_name: 'v1.1.0', assets: [] }))) as typeof fetch,
      nativeUpdater: {
        autoDownload: true,
        autoInstallOnAppQuit: true,
        async checkForUpdates() {
          checked = true
          return { updateInfo: { version: '1.1.0' } }
        },
        async downloadUpdate() {
          return []
        },
        quitAndInstall() {}
      }
    })
    expect((await service.check()).state).toBe('available')
    expect(checked).toBe(false)
    expect((await service.download()).state).toBe('manual-only')
  })

  it('fails closed when a supported packaged type has no native updater', async () => {
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      allowDirectDownload: false,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ tag_name: 'v1.1.0', assets: [] }))) as typeof fetch
    })
    expect((await service.check()).state).toBe('available')
    expect((await service.download()).state).toBe('manual-only')
  })

  it('surfaces a native shell open failure for a direct-download test path', async () => {
    const assetBytes = new TextEncoder().encode('synthetic update bytes')
    const assetHash = createHash('sha256').update(assetBytes).digest('hex')
    const service = new UpdateService({
      currentVersion: '1.0.0',
      platform: 'linux',
      packageType: 'appimage',
      openDownloaded: async () => 'open-failed',
      fetchImpl: (async (input) => {
        const url = String(input)
        if (url.endsWith('/SHA256SUMS')) {
          return new Response(`${assetHash}  bid-sentry-1.1.0-linux-x86_64.AppImage\n`)
        }
        if (url.endsWith('.AppImage')) return new Response(assetBytes)
        return new Response(
          JSON.stringify({
            tag_name: 'v1.1.0',
            assets: [
              {
                name: 'bid-sentry-1.1.0-linux-x86_64.AppImage',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/bid-sentry-1.1.0-linux-x86_64.AppImage'
              },
              {
                name: 'SHA256SUMS',
                browser_download_url:
                  'https://github.com/575674384-stack/bid-sentry/releases/download/v1.1.0/SHA256SUMS'
              }
            ]
          })
        )
      }) as typeof fetch
    })
    await service.check()
    expect((await service.download()).state).toBe('downloaded')
    expect((await service.install()).state).toBe('error')
  })

  it('uses the native updater only after explicit download and install commands', async () => {
    const calls: string[] = []
    const nativeUpdater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      async checkForUpdates() {
        calls.push('check')
        return { updateInfo: { version: '1.1.0', releaseNotes: 'notes' } }
      },
      async downloadUpdate() {
        calls.push('download')
        return []
      },
      quitAndInstall() {
        calls.push('install')
      }
    }
    const service = new UpdateService({
      currentVersion: '1.0.0',
      packageType: 'appimage',
      nativeUpdater
    })
    expect(nativeUpdater.autoDownload).toBe(false)
    expect(nativeUpdater.autoInstallOnAppQuit).toBe(false)
    expect((await service.check()).state).toBe('available')
    expect(calls).toEqual(['check'])
    expect((await service.download()).state).toBe('downloaded')
    expect(calls).toEqual(['check', 'download'])
    await service.install()
    expect(calls).toEqual(['check', 'download', 'install'])
  })
})

import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const realpathState = vi.hoisted(() => ({
  beforeNextCall: undefined as (() => Promise<void>) | undefined
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<{
    realpath(filePath: string): Promise<string>
    [name: string]: unknown
  }>()
  return {
    ...original,
    realpath: async (filePath: string) => {
      const hook = realpathState.beforeNextCall
      realpathState.beforeNextCall = undefined
      if (hook) await hook()
      return original.realpath(filePath)
    }
  }
})

import {
  resolvePathIdentityWithoutSymbolicLinks,
  resolvePathWithoutSymbolicLinks,
  sameFileSystemIdentity
} from '../../src/core/documents/pathSafety'

const temporaryDirectories: string[] = []

afterEach(async () => {
  realpathState.beforeNextCall = undefined
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('stable canonical path resolution', () => {
  it('uses stable device and inode identity semantics on Windows hard links', () => {
    const left = { device: '7', inode: '9', mode: '33152' }
    const right = { device: '7', inode: '9', mode: '33216' }
    expect(sameFileSystemIdentity(left, right, 'win32')).toBe(true)
    expect(sameFileSystemIdentity(left, right, 'linux')).toBe(false)
  })

  it('returns the canonical path for a stable regular file', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'input.pdf')
    await writeFile(filePath, '%PDF-1.7\n%%EOF', 'utf8')

    await expect(resolvePathWithoutSymbolicLinks(filePath)).resolves.toBe(await realpath(filePath))
    await expect(resolvePathIdentityWithoutSymbolicLinks(filePath)).resolves.toMatchObject({
      canonicalPath: await realpath(filePath),
      identity: {
        device: expect.stringMatching(/^\d+$/u),
        inode: expect.stringMatching(/^\d+$/u),
        mode: expect.stringMatching(/^\d+$/u)
      }
    })
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a parent changed to a symbolic link between validation and realpath',
    async () => {
      const directory = await createTemporaryDirectory()
      const selectedDirectory = join(directory, 'selected')
      const movedDirectory = join(directory, 'selected-original')
      const replacementDirectory = join(directory, 'replacement')
      const selectedFile = join(selectedDirectory, 'input.pdf')
      await mkdir(selectedDirectory)
      await mkdir(replacementDirectory)
      await writeFile(selectedFile, '%PDF-1.7\noriginal\n%%EOF', 'utf8')
      await writeFile(join(replacementDirectory, 'input.pdf'), '%PDF-1.7\nother\n%%EOF', 'utf8')

      realpathState.beforeNextCall = async () => {
        await rename(selectedDirectory, movedDirectory)
        await symlink(replacementDirectory, selectedDirectory, 'dir')
      }

      await expect(resolvePathWithoutSymbolicLinks(selectedFile)).rejects.toThrow()
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'rejects a file reached through a Windows junction',
    async () => {
      const directory = await createTemporaryDirectory()
      const realDirectory = join(directory, 'real')
      const junctionDirectory = join(directory, 'junction')
      await mkdir(realDirectory)
      await writeFile(join(realDirectory, 'input.pdf'), '%PDF-1.7\n%%EOF', 'utf8')
      await symlink(realDirectory, junctionDirectory, 'junction')

      await expect(
        resolvePathIdentityWithoutSymbolicLinks(join(junctionDirectory, 'input.pdf'))
      ).rejects.toThrow()
    }
  )
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-path-safety-'))
  temporaryDirectories.push(directory)
  return directory
}

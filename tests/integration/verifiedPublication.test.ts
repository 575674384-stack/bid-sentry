import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { resolvePathIdentityWithoutSymbolicLinks } from '../../src/core/documents/pathSafety'
import { publishVerifiedArtifacts } from '../../src/main/tasks/verifiedPublication'
import type { TemporaryWorkspaceDescriptor } from '../../src/shared/contracts'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('verified publication', () => {
  it('publishes only after fresh checks and removes the temporary workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-publication-'))
    directories.push(directory)
    const inputPath = join(directory, 'input.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const outputIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory)).identity
    const recorded: TemporaryWorkspaceDescriptor[] = []
    const forgotten: string[] = []

    const result = await publishVerifiedArtifacts({
      outputDirectory: directory,
      outputDirectoryIdentity: outputIdentity,
      inputs: [input],
      outputNames: ['report.json'],
      recordWorkspace: async (workspace) => {
        recorded.push(workspace)
      },
      forgetWorkspace: async (workspace) => {
        forgotten.push(workspace.rootPath)
      },
      write: async ({ temporaryPaths }) => {
        await import('node:fs/promises').then(({ writeFile }) =>
          writeFile(temporaryPaths[0]!, '{"ok":true}\n', { mode: 0o600 })
        )
        return { ok: true }
      },
      verify: async () => [[{ name: 'report-valid', status: 'passed', message: '报告结构通过。' }]]
    })

    expect(await readFile(join(directory, 'report.json'), 'utf8')).toBe('{"ok":true}\n')
    expect(result.artifacts[0]?.verification.status).toBe('passed')
    expect(recorded).toHaveLength(4)
    expect(recorded[0]).not.toHaveProperty('publication')
    expect(recorded[1]?.publication?.artifacts[0]).not.toHaveProperty('outputSha256')
    expect(recorded[2]?.publication?.artifacts[0]).toHaveProperty('outputSha256')
    expect(recorded[2]?.publication?.artifacts[0]).not.toHaveProperty('identity')
    expect(recorded[3]?.publication?.artifacts[0]).toHaveProperty('identity')
    expect(forgotten).toEqual([recorded.at(-1)?.rootPath])
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('.bid-sentry-tmp-'))
    ).toEqual([])
  })

  it('rolls back temporary output when the writer fails before publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-publication-failure-'))
    directories.push(directory)
    const inputPath = join(directory, 'input.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const outputIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory)).identity

    await expect(
      publishVerifiedArtifacts({
        outputDirectory: directory,
        outputDirectoryIdentity: outputIdentity,
        inputs: [input],
        outputNames: ['report.json'],
        write: async ({ temporaryPaths }) => {
          await import('node:fs/promises').then(({ writeFile }) =>
            writeFile(temporaryPaths[0]!, 'partial', { mode: 0o600 })
          )
          throw new Error('synthetic writer failure')
        },
        verify: async () => [[]]
      })
    ).rejects.toThrow('synthetic writer failure')

    expect((await readdir(directory)).filter((name) => name !== 'input.docx')).toEqual([])
  })

  it('rolls back a partial multi-file publication and preserves the conflicting path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-publication-partial-'))
    directories.push(directory)
    const inputPath = join(directory, 'input.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const outputIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory)).identity
    const recorded: TemporaryWorkspaceDescriptor[] = []
    const forgotten: TemporaryWorkspaceDescriptor[] = []
    let conflictCreated = false

    await expect(
      publishVerifiedArtifacts({
        outputDirectory: directory,
        outputDirectoryIdentity: outputIdentity,
        inputs: [input],
        outputNames: ['report.json', 'report.html'],
        recordWorkspace: async (workspace) => {
          recorded.push(workspace)
          const artifacts = workspace.publication?.artifacts
          if (artifacts?.[0]?.identity && !artifacts[1]?.identity && !conflictCreated) {
            conflictCreated = true
            await writeFile(join(directory, 'report.html'), 'user-owned conflict', 'utf8')
          }
        },
        forgetWorkspace: async (workspace) => {
          forgotten.push(workspace)
        },
        write: async ({ temporaryPaths }) => {
          await writeFile(temporaryPaths[0]!, '{"ok":true}\n', { mode: 0o600 })
          await writeFile(temporaryPaths[1]!, '<p>ok</p>\n', { mode: 0o600 })
          return undefined
        },
        verify: async () => [
          [{ name: 'json-valid', status: 'passed', message: 'JSON 通过。' }],
          [{ name: 'html-valid', status: 'passed', message: 'HTML 通过。' }]
        ]
      })
    ).rejects.toMatchObject({ appError: { code: 'OUTPUT_EXISTS' } })

    expect(conflictCreated).toBe(true)
    await expect(access(join(directory, 'report.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(directory, 'report.html'), 'utf8')).toBe('user-owned conflict')
    expect(forgotten).toHaveLength(1)
    expect(recorded.at(-1)?.publication?.artifacts[0]).toHaveProperty('identity')
    expect(recorded.at(-1)?.publication?.artifacts[1]).not.toHaveProperty('identity')
    expect(
      (await readdir(directory)).filter((name) => name.startsWith('.bid-sentry-tmp-'))
    ).toEqual([])
  })

  it('preserves same-inode edits and retains journal state when attestation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-publication-retained-'))
    directories.push(directory)
    const inputPath = join(directory, 'input.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const outputIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory)).identity
    const recorded: TemporaryWorkspaceDescriptor[] = []
    const forgotten: TemporaryWorkspaceDescriptor[] = []
    let replacementCreated = false

    await expect(
      publishVerifiedArtifacts({
        outputDirectory: directory,
        outputDirectoryIdentity: outputIdentity,
        inputs: [input],
        outputNames: ['report.json', 'report.html'],
        recordWorkspace: async (workspace) => {
          recorded.push(workspace)
          if (workspace.publication?.artifacts[0]?.identity && !replacementCreated) {
            replacementCreated = true
            await writeFile(join(directory, 'report.json'), 'user replacement', 'utf8')
          }
        },
        forgetWorkspace: async (workspace) => {
          forgotten.push(workspace)
        },
        write: async ({ temporaryPaths }) => {
          await writeFile(temporaryPaths[0]!, '{"ok":true}\n', { mode: 0o600 })
          await writeFile(temporaryPaths[1]!, '<p>ok</p>\n', { mode: 0o600 })
          return undefined
        },
        verify: async () => [
          [{ name: 'json-valid', status: 'passed', message: 'JSON 通过。' }],
          [{ name: 'html-valid', status: 'passed', message: 'HTML 通过。' }]
        ]
      })
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })

    expect(await readFile(join(directory, 'report.json'), 'utf8')).toBe('user replacement')
    expect(forgotten).toEqual([])
    expect(recorded.at(-1)?.publication?.artifacts[0]).toMatchObject({
      outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      identity: expect.objectContaining({ device: expect.any(String), inode: expect.any(String) })
    })
    await expect(access(recorded.at(-1)!.rootPath)).resolves.toBeUndefined()
  })
})

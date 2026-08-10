import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTemporaryWorkspace,
  reserveTemporaryFile,
  sha256File
} from '../../src/core/documents/fileSafety'
import { fileSystemIdentityFromBigInts } from '../../src/core/documents/pathSafety'
import { WorkspaceJournal } from '../../src/main/tasks/workspaceJournal'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('WorkspaceJournal', () => {
  it('recovers only an exactly journaled temporary workspace and clears the journal', async () => {
    const directory = await createTemporaryDirectory()
    const outputDirectory = join(directory, 'output')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(outputDirectory))
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'sanitized.docx')
    const unrelatedLink = join(outputDirectory, 'user-owned-link.docx')
    await writeFile(temporaryPath, 'legacy sanitizer bytes', 'utf8')
    await link(temporaryPath, unrelatedLink)
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add(workspace)

    if (process.platform !== 'win32') {
      expect((await stat(journalPath)).mode & 0o777).toBe(0o600)
    }
    expect(await readFile(journalPath, 'utf8')).toContain('.bid-sentry-tmp-')
    await journal.recover()

    await expect(access(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(unrelatedLink, 'utf8')).toBe('legacy sanitizer bytes')
    await expect(access(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back final hard links left by a crash between multi-file publications', async () => {
    const directory = await createTemporaryDirectory()
    const outputDirectory = join(directory, 'output')
    await mkdir(outputDirectory)
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const firstTemporaryPath = await reserveTemporaryFile(workspace, 'report.json')
    const secondTemporaryPath = await reserveTemporaryFile(workspace, 'report.html')
    await writeFile(firstTemporaryPath, '{"ok":true}\n', { mode: 0o600 })
    await writeFile(secondTemporaryPath, '<p>ok</p>\n', { mode: 0o600 })
    const firstFinalPath = join(outputDirectory, 'report.json')
    const secondFinalPath = join(outputDirectory, 'report.html')
    const userLink = join(outputDirectory, 'user-owned-link')
    await link(firstTemporaryPath, firstFinalPath)
    await link(firstTemporaryPath, userLink)
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add({
      rootPath: workspace.rootPath,
      outputDirectory: workspace.outputDirectory,
      rootIdentity: workspace.rootIdentity,
      outputDirectoryIdentity: workspace.outputDirectoryIdentity,
      publication: {
        artifacts: [
          { temporaryPath: firstTemporaryPath, outputPath: firstFinalPath },
          { temporaryPath: secondTemporaryPath, outputPath: secondFinalPath }
        ]
      }
    })

    await journal.recover()

    await expect(access(firstFinalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(secondFinalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(userLink)).resolves.toBeUndefined()
    await expect(access(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a replacement at a journaled output path when its identity changed', async () => {
    const directory = await createTemporaryDirectory()
    const outputDirectory = join(directory, 'output')
    await mkdir(outputDirectory)
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'report.json')
    await writeFile(temporaryPath, '{"task":true}\n', { mode: 0o600 })
    const outputPath = join(outputDirectory, 'report.json')
    await link(temporaryPath, outputPath)
    const publishedInfo = await lstat(outputPath, { bigint: true })
    const publishedIdentity = fileSystemIdentityFromBigInts(
      publishedInfo.dev,
      publishedInfo.ino,
      publishedInfo.mode
    )
    const outputSha256 = await sha256File(outputPath)
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add({
      rootPath: workspace.rootPath,
      outputDirectory: workspace.outputDirectory,
      rootIdentity: workspace.rootIdentity,
      outputDirectoryIdentity: workspace.outputDirectoryIdentity,
      publication: {
        artifacts: [{ temporaryPath, outputPath, outputSha256, identity: publishedIdentity }]
      }
    })
    await unlink(outputPath)
    await writeFile(outputPath, 'user replacement', 'utf8')

    await journal.recover()

    expect(await readFile(outputPath, 'utf8')).toBe('user replacement')
    await expect(access(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back complete journaled identities after workspace cleanup was interrupted', async () => {
    const directory = await createTemporaryDirectory()
    const outputDirectory = join(directory, 'output')
    await mkdir(outputDirectory)
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'report.json')
    await writeFile(temporaryPath, '{"task":true}\n', { mode: 0o600 })
    const outputPath = join(outputDirectory, 'report.json')
    const unrelatedLink = join(outputDirectory, 'user-owned-link')
    await link(temporaryPath, outputPath)
    await link(temporaryPath, unrelatedLink)
    const publishedInfo = await lstat(outputPath, { bigint: true })
    const identity = fileSystemIdentityFromBigInts(
      publishedInfo.dev,
      publishedInfo.ino,
      publishedInfo.mode
    )
    const outputSha256 = await sha256File(outputPath)
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add({
      rootPath: workspace.rootPath,
      outputDirectory: workspace.outputDirectory,
      rootIdentity: workspace.rootIdentity,
      outputDirectoryIdentity: workspace.outputDirectoryIdentity,
      publication: {
        artifacts: [{ temporaryPath, outputPath, outputSha256, identity }]
      }
    })
    await rm(workspace.rootPath, { recursive: true, force: true })

    await journal.recover()

    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(unrelatedLink, 'utf8')).toBe('{"task":true}\n')
    await expect(access(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('quarantines malformed state without attempting an untrusted cleanup path', async () => {
    const directory = await createTemporaryDirectory()
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    await writeFile(journalPath, '{"rootPath":"/"}', 'utf8')
    const cleaned: string[] = []
    const journal = new WorkspaceJournal(
      journalPath,
      async (workspace) => {
        cleaned.push(workspace.rootPath)
      },
      () => 1234
    )

    await journal.recover()

    expect(cleaned).toEqual([])
    expect(
      (await readdir(directory)).some((name) =>
        name.startsWith('temporary-workspaces.v1.json.corrupt-1234-')
      )
    ).toBe(true)
  })

  it('quarantines a legacy path-only journal without invoking cleanup', async () => {
    const directory = await createTemporaryDirectory()
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    await writeFile(
      journalPath,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            rootPath: join(directory, '.bid-sentry-tmp-legacy'),
            outputDirectory: directory
          }
        ]
      }),
      'utf8'
    )
    const cleaned: string[] = []
    const journal = new WorkspaceJournal(
      journalPath,
      async (workspace) => {
        cleaned.push(workspace.rootPath)
      },
      () => 2345
    )

    await journal.recover()

    expect(cleaned).toEqual([])
    expect(
      (await readdir(directory)).some((name) =>
        name.startsWith('temporary-workspaces.v1.json.corrupt-2345-')
      )
    ).toBe(true)
  })

  it('does not delete a same-name directory that replaced a journaled workspace', async () => {
    const directory = await createTemporaryDirectory()
    const outputDirectory = join(directory, 'output')
    await mkdir(outputDirectory)
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add(workspace)

    const movedWorkspace = `${workspace.rootPath}-moved`
    await rename(workspace.rootPath, movedWorkspace)
    await mkdir(workspace.rootPath)
    const replacementFile = join(workspace.rootPath, 'user-owned.txt')
    await writeFile(replacementFile, 'preserve replacement', 'utf8')

    await journal.recover()

    expect(await readFile(replacementFile, 'utf8')).toBe('preserve replacement')
    await expect(access(movedWorkspace)).resolves.toBeUndefined()
    await expect(access(journalPath)).resolves.toBeUndefined()
  })

  it('quarantines an oversized journal without parsing or cleaning its contents', async () => {
    const directory = await createTemporaryDirectory()
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    await writeFile(journalPath, 'x'.repeat(1024 * 1024 + 1), 'utf8')
    const cleaned: string[] = []
    const journal = new WorkspaceJournal(
      journalPath,
      async (workspace) => {
        cleaned.push(workspace.rootPath)
      },
      () => 5678
    )

    await journal.recover()

    expect(cleaned).toEqual([])
    expect(
      (await readdir(directory)).some((name) =>
        name.startsWith('temporary-workspaces.v1.json.corrupt-5678-')
      )
    ).toBe(true)
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-workspace-journal-'))
  temporaryDirectories.push(directory)
  return directory
}

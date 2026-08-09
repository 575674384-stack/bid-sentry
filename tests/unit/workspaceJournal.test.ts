import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryWorkspace } from '../../src/core/documents/fileSafety'
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
    const journalPath = join(directory, 'temporary-workspaces.v1.json')
    const journal = new WorkspaceJournal(journalPath)
    await journal.add(workspace)

    if (process.platform !== 'win32') {
      expect((await stat(journalPath)).mode & 0o777).toBe(0o600)
    }
    expect(await readFile(journalPath, 'utf8')).toContain('.bid-sentry-tmp-')
    await journal.recover()

    await expect(access(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
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

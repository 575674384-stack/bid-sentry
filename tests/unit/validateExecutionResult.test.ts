import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInputSnapshot, createTemporaryWorkspace } from '../../src/core/documents/fileSafety'
import { SanitizationJob } from '../../src/core/sanitization/sanitizeJob'
import { validateExecutionResultArtifacts } from '../../src/main/tasks/validateExecutionResult'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'
import { writeExecutionResultFixture } from '../fixtures/builders/executionResultFixture'

const TASK_ID = '123e4567-e89b-42d3-a456-426614174000'
const INPUT_SHA256 = 'a'.repeat(64)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('Main execution artifact validation', () => {
  it('validates the UUID-prefixed workspace artifacts produced by a real sanitization job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bid-sentry-real-result-validation-'))
    temporaryDirectories.push(root)
    const inputPath = join(root, 'input.docx')
    const outputDirectory = join(root, 'output')
    await mkdir(outputDirectory)
    await writeDocxFixture(inputPath)
    const taskId = randomUUID()
    const inputId = randomUUID()
    const job = new SanitizationJob()
    const preview = await job.preview(
      {
        schemaVersion: 1,
        type: 'preview',
        taskId,
        inputs: [{ inputId, snapshot: await createInputSnapshot(inputPath) }]
      },
      new AbortController().signal
    )
    const workspace = await createTemporaryWorkspace(outputDirectory)
    const result = await job.execute(
      {
        taskId,
        planDigest: preview.planDigest,
        outputDirectory,
        workspaceRootPath: workspace.rootPath,
        appVersion: '0.1.0'
      },
      new AbortController().signal
    )

    expect((await readdir(workspace.rootPath)).every((name) => /^[0-9a-f-]{36}-/u.test(name))).toBe(
      true
    )
    await expect(
      validateExecutionResultArtifacts({
        result,
        outputDirectory,
        workspaceRootPath: workspace.rootPath,
        logicalResultValid: true
      })
    ).resolves.toHaveLength(3)
  })

  it('accepts only task-owned hard links whose bytes match the report', async () => {
    const fixture = await createFixture()
    const workspaceNames = await readdir(fixture.workspaceRootPath)
    expect(workspaceNames).toHaveLength(3)
    expect(workspaceNames.every((name) => /^[0-9a-f-]{36}-/u.test(name))).toBe(true)

    const published = await validateExecutionResultArtifacts({
      result: fixture.result,
      outputDirectory: fixture.outputDirectory,
      workspaceRootPath: fixture.workspaceRootPath,
      logicalResultValid: true
    })

    expect(published).toHaveLength(3)
    expect(new Set(published.map((file) => `${file.device}:${file.inode}`)).size).toBe(3)
  })

  it('rejects a hash mismatch and rolls back the other verified artifacts', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.result.outputPaths[0] as string, 'tampered in place', 'utf8')

    await expect(validateFixture(fixture)).rejects.toThrow()

    await expect(access(fixture.result.outputPaths[0] as string)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(fixture.result.jsonReportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(fixture.result.htmlReportPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not delete a user replacement when the published path becomes a symlink', async () => {
    const fixture = await createFixture()
    const outputPath = fixture.result.outputPaths[0] as string
    const userFile = join(fixture.outputDirectory, 'user-owned.txt')
    await writeFile(userFile, 'user owned', 'utf8')
    await unlink(outputPath)
    await symlink(userFile, outputPath)

    await expect(validateFixture(fixture)).rejects.toThrow()

    expect(await readFile(userFile, 'utf8')).toBe('user owned')
    expect(await readFile(outputPath, 'utf8')).toBe('user owned')
  })

  it('rejects duplicate or inconsistent declared paths and rolls back canonical outputs', async () => {
    const fixture = await createFixture()
    const malformed = {
      ...fixture.result,
      jsonReportPath: fixture.result.outputPaths[0] as string
    }

    await expect(
      validateExecutionResultArtifacts({
        result: malformed,
        outputDirectory: fixture.outputDirectory,
        workspaceRootPath: fixture.workspaceRootPath,
        logicalResultValid: false
      })
    ).rejects.toThrow()

    for (const finalPath of [
      ...fixture.result.outputPaths,
      fixture.result.jsonReportPath,
      fixture.result.htmlReportPath
    ]) {
      await expect(access(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('rejects a non-regular replacement without deleting it', async () => {
    const fixture = await createFixture()
    const outputPath = fixture.result.outputPaths[0] as string
    await unlink(outputPath)
    await mkdir(outputPath)

    await expect(validateFixture(fixture)).rejects.toThrow()

    await expect(access(outputPath)).resolves.toBeUndefined()
  })
})

async function createFixture(): Promise<{
  outputDirectory: string
  workspaceRootPath: string
  result: Awaited<ReturnType<typeof writeExecutionResultFixture>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'bid-sentry-result-validation-'))
  temporaryDirectories.push(root)
  const outputDirectory = join(root, 'output')
  const workspaceRootPath = join(outputDirectory, '.bid-sentry-tmp-test')
  await mkdir(outputDirectory)
  const result = await writeExecutionResultFixture({
    taskId: TASK_ID,
    inputSha256: INPUT_SHA256,
    inputDisplayName: 'input.docx',
    outputDirectory,
    workspaceRootPath
  })
  return { outputDirectory, workspaceRootPath, result }
}

function validateFixture(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<unknown> {
  return validateExecutionResultArtifacts({
    result: fixture.result,
    outputDirectory: fixture.outputDirectory,
    workspaceRootPath: fixture.workspaceRootPath,
    logicalResultValid: true
  })
}

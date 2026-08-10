import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  normalizeFileIdentity,
  rollbackPublishedFiles,
  sha256File,
  type PublishedFile
} from '../../core/documents/fileSafety'
import {
  fileSystemIdentityFromBigInts,
  sameFileSystemIdentity,
  sameRealPath
} from '../../core/documents/pathSafety'
import {
  renderSanitizationReportHtml,
  serializeSanitizationReport
} from '../../core/sanitization/report'
import { buildReportPaths } from '../../core/sanitization/sanitizeResult'
import type { FileSystemIdentity, WorkerExecutionResult } from '../../shared/contracts'

interface ExpectedArtifact {
  finalPath: string
  size: number
  sha256: string
}

interface WorkspaceArtifact {
  absolutePath: string
  identity: FileSystemIdentity
}

interface ArtifactValidation {
  publishedFile: PublishedFile
  valid: boolean
  error?: unknown
}

export async function validateExecutionResultArtifacts(options: {
  result: WorkerExecutionResult
  outputDirectories: string[]
  workspaceRootPath: string
  logicalResultValid: boolean
}): Promise<PublishedFile[]> {
  const { artifacts: expected, declaredPathsMatch } = await expectedArtifacts(options)
  const workspaceArtifacts = await readWorkspaceArtifacts(options.workspaceRootPath)
  const rollbackCandidates: PublishedFile[] = []
  const validationErrors: unknown[] = []
  let validationFailed = !options.logicalResultValid || !declaredPathsMatch
  if (validationFailed) validationErrors.push(new Error('Execution result identity mismatch.'))

  if (
    new Set(expected.map((artifact) => normalizeFileIdentity(artifact.finalPath))).size !==
    expected.length
  ) {
    validationFailed = true
  }

  for (const artifact of expected) {
    try {
      const validation = await validateArtifact(artifact, workspaceArtifacts)
      rollbackCandidates.push(validation.publishedFile)
      if (!validation.valid) {
        validationErrors.push(validation.error)
        validationFailed = true
      }
    } catch (error) {
      validationErrors.push(error)
      validationFailed = true
    }
  }

  const inodeIdentities = rollbackCandidates
    .filter((artifact) => artifact.identity.device !== '0' || artifact.identity.inode !== '0')
    .map((artifact) => `${artifact.identity.device}:${artifact.identity.inode}`)
  if (new Set(inodeIdentities).size !== inodeIdentities.length) {
    validationErrors.push(new Error('Execution artifacts reused the same inode.'))
    validationFailed = true
  }

  if (!validationFailed) return rollbackCandidates

  try {
    await rollbackPublishedFiles(rollbackCandidates)
  } catch (rollbackError) {
    throw new AggregateError(
      [...validationErrors, rollbackError],
      'Execution artifact validation and rollback failed.',
      { cause: rollbackError }
    )
  }
  throw new AggregateError(
    validationErrors,
    'Published execution artifacts failed Main-process validation.'
  )
}

async function expectedArtifacts(options: {
  result: WorkerExecutionResult
  outputDirectories: string[]
}): Promise<{ artifacts: ExpectedArtifact[]; declaredPathsMatch: boolean }> {
  const reportDirectory = resolve(options.outputDirectories[0] ?? '')
  const expectedDirectories = options.outputDirectories.map((directory) => resolve(directory))
  const safeDisplayNames = options.result.report.files.every(
    (file) =>
      basename(file.outputDisplayName) === file.outputDisplayName &&
      file.outputDisplayName !== '.' &&
      file.outputDisplayName !== '..'
  )
  const canonicalDocumentPaths = options.result.report.files.map((file, index) =>
    join(expectedDirectories[index] as string, basename(file.outputDisplayName))
  )
  const canonicalReportPaths = buildReportPaths(options.result.taskId, reportDirectory)
  const canonicalPaths = [
    ...canonicalDocumentPaths,
    canonicalReportPaths.json,
    canonicalReportPaths.html
  ]
  const declaredPaths = [
    ...options.result.outputPaths,
    options.result.jsonReportPath,
    options.result.htmlReportPath
  ]
  const declaredDocumentPathsMatch =
    safeDisplayNames &&
    canonicalDocumentPaths.length === options.result.outputPaths.length &&
    (await declaredDocumentsMatch(
      canonicalDocumentPaths,
      options.result.outputPaths,
      expectedDirectories
    ))
  const declaredReportPathsMatch =
    (await sameRealPath(canonicalReportPaths.json, options.result.jsonReportPath)) &&
    (await sameRealPath(dirname(resolve(canonicalReportPaths.json)), reportDirectory)) &&
    (await sameRealPath(canonicalReportPaths.html, options.result.htmlReportPath)) &&
    (await sameRealPath(dirname(resolve(canonicalReportPaths.html)), reportDirectory))
  const declaredPathsMatch =
    declaredDocumentPathsMatch &&
    declaredReportPathsMatch &&
    canonicalPaths.length === declaredPaths.length

  const documentArtifacts = canonicalDocumentPaths.map((finalPath, index) => {
    const output = options.result.report.files[index]?.output
    if (!output) throw new Error('Execution result document identity mismatch.')
    return {
      finalPath: resolve(finalPath),
      size: output.size,
      sha256: output.sha256
    }
  })
  const json = Buffer.from(serializeSanitizationReport(options.result.report), 'utf8')
  const html = Buffer.from(renderSanitizationReportHtml(options.result.report), 'utf8')
  return {
    artifacts: [
      ...documentArtifacts,
      expectedTextArtifact(canonicalReportPaths.json, json),
      expectedTextArtifact(canonicalReportPaths.html, html)
    ],
    declaredPathsMatch
  }
}

function expectedTextArtifact(finalPath: string, contents: Buffer): ExpectedArtifact {
  return {
    finalPath: resolve(finalPath),
    size: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex')
  }
}

async function declaredDocumentsMatch(
  canonicalDocumentPaths: readonly string[],
  declaredOutputPaths: readonly string[],
  expectedDirectories: readonly string[]
): Promise<boolean> {
  for (const [index, canonicalPath] of canonicalDocumentPaths.entries()) {
    const declaredPath = declaredOutputPaths[index] as string
    if (
      !(await sameRealPath(canonicalPath, declaredPath)) ||
      !(await sameRealPath(dirname(resolve(canonicalPath)), expectedDirectories[index] as string))
    ) {
      return false
    }
  }
  return true
}

async function validateArtifact(
  artifact: ExpectedArtifact,
  workspaceArtifacts: readonly WorkspaceArtifact[]
): Promise<ArtifactValidation> {
  const finalBefore = await lstat(artifact.finalPath, { bigint: true })
  assertRegularFile(finalBefore)
  const finalIdentity = fileSystemIdentityFromBigInts(
    finalBefore.dev,
    finalBefore.ino,
    finalBefore.mode
  )
  const temporaryPath = findWorkspaceLink(workspaceArtifacts, finalIdentity)
  const temporaryBefore = await lstat(temporaryPath, { bigint: true })
  assertMatchingRegularFiles(temporaryBefore, finalBefore)
  const publishedFile = {
    absolutePath: resolve(artifact.finalPath),
    identity: finalIdentity
  }
  try {
    if (finalBefore.size !== BigInt(artifact.size)) {
      throw new Error('Published artifact size mismatch.')
    }
    const sha256 = await sha256File(artifact.finalPath)
    const [temporaryAfter, finalAfter] = await Promise.all([
      lstat(temporaryPath, { bigint: true }),
      lstat(artifact.finalPath, { bigint: true })
    ])
    assertMatchingRegularFiles(temporaryAfter, finalAfter)
    if (
      !sameStatsIdentity(temporaryAfter, temporaryBefore) ||
      !sameStatsIdentity(finalAfter, finalBefore) ||
      finalAfter.size !== BigInt(artifact.size) ||
      sha256 !== artifact.sha256
    ) {
      throw new Error('Published artifact changed during validation.')
    }
    return { publishedFile, valid: true }
  } catch (error) {
    return { publishedFile, valid: false, error }
  }
}

async function readWorkspaceArtifacts(workspaceRootPath: string): Promise<WorkspaceArtifact[]> {
  const rootPath = resolve(workspaceRootPath)
  const entries = await readdir(rootPath, { withFileTypes: true })
  const artifacts: WorkspaceArtifact[] = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue
    const absolutePath = join(rootPath, entry.name)
    const info = await lstat(absolutePath, { bigint: true })
    if (!info.isFile() || info.isSymbolicLink()) continue
    artifacts.push({
      absolutePath,
      identity: fileSystemIdentityFromBigInts(info.dev, info.ino, info.mode)
    })
  }
  return artifacts
}

function findWorkspaceLink(
  workspaceArtifacts: readonly WorkspaceArtifact[],
  identity: FileSystemIdentity
): string {
  const matches = workspaceArtifacts.filter((artifact) =>
    sameFileSystemIdentity(artifact.identity, identity)
  )
  if (matches.length !== 1) {
    throw new Error('Published artifact does not have one task-owned workspace link.')
  }
  return matches[0]?.absolutePath as string
}

function assertRegularFile(info: BigIntStats): void {
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Published artifact is not a regular file.')
  }
}

function assertMatchingRegularFiles(temporary: BigIntStats, final: BigIntStats): void {
  assertRegularFile(temporary)
  assertRegularFile(final)
  if (!sameStatsIdentity(temporary, final)) {
    throw new Error('Published artifact is not the task-owned workspace file.')
  }
}

function sameStatsIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileSystemIdentity(
    fileSystemIdentityFromBigInts(left.dev, left.ino, left.mode),
    fileSystemIdentityFromBigInts(right.dev, right.ino, right.mode)
  )
}

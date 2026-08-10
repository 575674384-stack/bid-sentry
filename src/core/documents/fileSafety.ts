import { createHash, randomUUID } from 'node:crypto'
import { lstat, link, mkdtemp, open, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve, sep } from 'node:path'
import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom'
import * as yauzl from 'yauzl'
import {
  InputSnapshotSchema,
  TemporaryWorkspaceDescriptorSchema,
  VerificationReportSchema,
  createAppError,
  toSafeAppError,
  withDiagnostic,
  type DiagnosticStage,
  type AppError,
  type AppErrorCode,
  type DocumentType,
  type FileSystemIdentity,
  type InputSnapshot,
  type OutputMode,
  type TemporaryWorkspaceDescriptor,
  type WorkspacePublicationArtifact,
  type VerificationReport
} from '../../shared/contracts'
import {
  fileSystemIdentityFromBigInts,
  normalizeFileIdentity,
  resolvePathIdentityWithoutSymbolicLinks,
  resolvePathWithoutSymbolicLinks,
  sameFileSystemIdentity,
  sameRealPath
} from './pathSafety'

export { normalizeFileIdentity } from './pathSafety'

export const MAX_INPUT_BYTES = 200 * 1024 * 1024
const MAX_MARKER_XML_BYTES = 1024 * 1024
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TEMPORARY_DIRECTORY_PREFIX = '.bid-sentry-tmp-'
const TRUSTED_WORKSPACES = new WeakSet<TemporaryWorkspace>()

export class DocumentSafetyError extends Error {
  readonly appError: AppError

  constructor(codeOrError: AppErrorCode | AppError, cause?: unknown) {
    const appError = typeof codeOrError === 'string' ? createAppError(codeOrError) : codeOrError
    super(appError.message, cause === undefined ? undefined : { cause })
    this.name = 'DocumentSafetyError'
    this.appError = appError
  }
}

/** Convert an arbitrary task-boundary failure into a safe, diagnosable error. */
export function withDiagnosticDocumentError(
  error: unknown,
  stage: DiagnosticStage
): DocumentSafetyError {
  const safe = error instanceof DocumentSafetyError ? error.appError : toSafeAppError(error)
  return new DocumentSafetyError(withDiagnostic(safe, stage), error)
}

export class TemporaryWorkspace {
  readonly #reservedPaths = new Set<string>()
  readonly rootPath: string
  readonly outputDirectory: string
  readonly rootIdentity: FileSystemIdentity
  readonly outputDirectoryIdentity: FileSystemIdentity

  constructor(
    rootPath: string,
    outputDirectory: string,
    rootIdentity: FileSystemIdentity,
    outputDirectoryIdentity: FileSystemIdentity
  ) {
    const descriptor = TemporaryWorkspaceDescriptorSchema.parse({
      rootPath: resolve(rootPath),
      outputDirectory: resolve(outputDirectory),
      rootIdentity,
      outputDirectoryIdentity
    })
    this.rootPath = descriptor.rootPath
    this.outputDirectory = descriptor.outputDirectory
    this.rootIdentity = descriptor.rootIdentity
    this.outputDirectoryIdentity = descriptor.outputDirectoryIdentity
  }

  register(filePath: string): void {
    const resolvedPath = resolve(filePath)
    if (dirname(resolvedPath) !== resolve(this.rootPath)) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    this.#reservedPaths.add(resolvedPath)
  }

  contains(filePath: string): boolean {
    return this.#reservedPaths.has(resolve(filePath))
  }
}

export interface PublishedFile {
  absolutePath: string
  identity: FileSystemIdentity
  /**
   * Overwrite mode only: workspace hard link holding the original input bytes.
   * Rollback renames it back over the published path; successful cleanup
   * removes it together with the workspace.
   */
  backupPath?: string
}

export async function createInputSnapshot(
  inputPath: string,
  signal?: AbortSignal
): Promise<InputSnapshot> {
  throwIfAborted(signal)
  const absolutePath = await resolvePathWithoutSymbolicLinks(inputPath).catch((error: unknown) => {
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  })
  const fileInfo = await lstat(absolutePath).catch((error: unknown) => {
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  })

  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  if (fileInfo.size > MAX_INPUT_BYTES) {
    throw new DocumentSafetyError('FILE_TOO_LARGE')
  }

  const documentType = await detectDocumentType(absolutePath, signal)
  const sha256 = await sha256File(absolutePath, signal)

  return InputSnapshotSchema.parse({
    schemaVersion: 1,
    absolutePath,
    displayName: basename(absolutePath),
    documentType,
    size: fileInfo.size,
    sha256,
    mtimeMs: fileInfo.mtimeMs
  })
}

export async function assertInputUnchanged(
  snapshot: InputSnapshot,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  const canonicalPath = await resolvePathWithoutSymbolicLinks(snapshot.absolutePath).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('FILE_CHANGED', error)
    }
  )
  const current = await lstat(canonicalPath).catch((error: unknown) => {
    throw new DocumentSafetyError('FILE_CHANGED', error)
  })

  if (!current.isFile() || current.isSymbolicLink()) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
  if (
    normalizeFileIdentity(canonicalPath) !== normalizeFileIdentity(snapshot.absolutePath) ||
    current.size !== snapshot.size ||
    current.mtimeMs !== snapshot.mtimeMs
  ) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
  if ((await sha256File(snapshot.absolutePath, signal)) !== snapshot.sha256) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
}

export async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  const hash = createHash('sha256')
  // Hash through an opened descriptor, not by repeatedly reopening a path.
  // A watcher can replace a pathname while it is being read; the descriptor
  // keeps the bytes tied to the inode that was attested at open time.
  const beforeOpen = await lstat(filePath, { bigint: true }).catch((error: unknown) => {
    throw new DocumentSafetyError('FILE_CHANGED', error)
  })
  if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
  const handle = await open(filePath, 'r').catch((error: unknown) => {
    throw new DocumentSafetyError('FILE_CHANGED', error)
  })
  let stream: ReturnType<typeof handle.createReadStream> | null = null

  try {
    const opened = await handle.stat({ bigint: true })
    const openedIdentity = fileSystemIdentityFromBigInts(opened.dev, opened.ino, opened.mode)
    if (
      !sameFileSystemIdentity(
        openedIdentity,
        fileSystemIdentityFromBigInts(beforeOpen.dev, beforeOpen.ino, beforeOpen.mode)
      )
    ) {
      throw new DocumentSafetyError('FILE_CHANGED')
    }
    stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) {
      throwIfAborted(signal)
      hash.update(chunk as Buffer)
    }
    const afterRead = await lstat(filePath, { bigint: true })
    if (
      !afterRead.isFile() ||
      afterRead.isSymbolicLink() ||
      !sameFileSystemIdentity(
        fileSystemIdentityFromBigInts(afterRead.dev, afterRead.ino, afterRead.mode),
        openedIdentity
      )
    ) {
      throw new DocumentSafetyError('FILE_CHANGED')
    }
    return hash.digest('hex')
  } catch (error) {
    stream?.destroy()
    if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
    throw error
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function createTemporaryWorkspace(
  outputDirectory: string,
  expectedOutputDirectoryIdentity?: FileSystemIdentity
): Promise<TemporaryWorkspace> {
  const selectedOutput = await resolvePathIdentityWithoutSymbolicLinks(outputDirectory).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INVALID_DOCUMENT', error)
    }
  )
  const outputInfo = await lstat(selectedOutput.canonicalPath).catch((error: unknown) => {
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  })
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  if (
    expectedOutputDirectoryIdentity &&
    !sameFileSystemIdentity(selectedOutput.identity, expectedOutputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }

  const rootPath = await mkdtemp(join(selectedOutput.canonicalPath, TEMPORARY_DIRECTORY_PREFIX))
  const createdRoot = await resolvePathIdentityWithoutSymbolicLinks(rootPath).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  const currentOutput = await resolvePathIdentityWithoutSymbolicLinks(
    selectedOutput.canonicalPath
  ).catch(async (error: unknown) => {
    await removeUnadoptedWorkspace(rootPath, selectedOutput.canonicalPath, createdRoot.identity)
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    normalizeFileIdentity(dirname(createdRoot.canonicalPath)) !==
      normalizeFileIdentity(currentOutput.canonicalPath) ||
    !sameFileSystemIdentity(selectedOutput.identity, currentOutput.identity)
  ) {
    await removeUnadoptedWorkspace(rootPath, selectedOutput.canonicalPath, createdRoot.identity)
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const workspace = new TemporaryWorkspace(
    createdRoot.canonicalPath,
    currentOutput.canonicalPath,
    createdRoot.identity,
    currentOutput.identity
  )
  TRUSTED_WORKSPACES.add(workspace)
  return workspace
}

async function removeUnadoptedWorkspace(
  rootPath: string,
  expectedParent: string,
  expectedIdentity: FileSystemIdentity
): Promise<void> {
  try {
    const current = await resolvePathIdentityWithoutSymbolicLinks(rootPath)
    if (
      normalizeFileIdentity(current.canonicalPath) !== normalizeFileIdentity(rootPath) ||
      normalizeFileIdentity(dirname(current.canonicalPath)) !==
        normalizeFileIdentity(expectedParent) ||
      !sameFileSystemIdentity(current.identity, expectedIdentity)
    ) {
      return
    }
    const info = await lstat(current.canonicalPath)
    if (!info.isDirectory() || info.isSymbolicLink()) return
    await rm(current.canonicalPath, { recursive: true, force: true })
  } catch {
    // The directory may already have been detached by the replacement.  It
    // is deliberately left for the next explicit workspace recovery rather
    // than deleting an ambiguous path.
  }
}

export async function adoptTemporaryWorkspace(
  descriptorInput: TemporaryWorkspaceDescriptor
): Promise<TemporaryWorkspace> {
  const descriptor = TemporaryWorkspaceDescriptorSchema.parse(descriptorInput)
  const [resolvedRoot, resolvedOutput] = await Promise.all([
    resolvePathIdentityWithoutSymbolicLinks(descriptor.rootPath),
    resolvePathIdentityWithoutSymbolicLinks(descriptor.outputDirectory)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    normalizeFileIdentity(dirname(resolvedRoot.canonicalPath)) !==
      normalizeFileIdentity(resolvedOutput.canonicalPath) ||
    !basename(resolvedRoot.canonicalPath).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    normalizeFileIdentity(resolvedRoot.canonicalPath) !==
      normalizeFileIdentity(descriptor.rootPath) ||
    normalizeFileIdentity(resolvedOutput.canonicalPath) !==
      normalizeFileIdentity(descriptor.outputDirectory) ||
    !sameFileSystemIdentity(resolvedRoot.identity, descriptor.rootIdentity) ||
    !sameFileSystemIdentity(resolvedOutput.identity, descriptor.outputDirectoryIdentity) ||
    resolvedRoot.canonicalPath === resolvedOutput.canonicalPath ||
    resolvedRoot.canonicalPath === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [rootInfo, outputInfo] = await Promise.all([
    lstat(resolvedRoot.canonicalPath),
    lstat(resolvedOutput.canonicalPath)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink()
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const workspace = new TemporaryWorkspace(
    resolvedRoot.canonicalPath,
    resolvedOutput.canonicalPath,
    descriptor.rootIdentity,
    descriptor.outputDirectoryIdentity
  )
  TRUSTED_WORKSPACES.add(workspace)
  return workspace
}

export async function reserveTemporaryFile(
  workspace: TemporaryWorkspace,
  displayName: string
): Promise<string> {
  assertTrustedWorkspace(workspace)
  await assertWorkspaceIdentities(workspace)
  const safeName = basename(displayName)
  if (!safeName || safeName !== displayName || safeName === '.' || safeName === '..') {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const temporaryPath = join(workspace.rootPath, `${randomUUID()}-${safeName}`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  await handle.close()
  workspace.register(temporaryPath)
  return temporaryPath
}

const MAX_OUTPUT_NAME_ATTEMPTS = 99

/**
 * Output files always live next to their own input. `suffix` mode appends the
 * configured (contract-validated) suffix to the input base name; `overwrite`
 * mode returns the input path itself, which is replaced only after
 * verification passed.
 */
export function buildSanitizedOutputPath(
  inputPath: string,
  mode: OutputMode,
  suffix: string
): string {
  const resolvedInput = resolve(inputPath)
  if (mode === 'overwrite') return resolvedInput
  const parts = parse(basename(resolvedInput))
  return join(dirname(resolvedInput), `${parts.name}${suffix}${parts.ext.toLowerCase()}`)
}

/**
 * Picks a collision-free suffix-mode output path: a pre-existing
 * `name<suffix>.ext` yields `name<suffix> (2).ext`, ` (3)`, and so on, up to
 * a bounded number of attempts. `reserved` carries the normalized paths
 * already claimed earlier in the same batch. Publication still treats a
 * last-instant race (EEXIST) as a hard error.
 */
export async function findAvailableSanitizedOutputPath(
  baseOutputPath: string,
  reserved: ReadonlySet<string>
): Promise<string> {
  const parts = parse(baseOutputPath)
  for (let attempt = 1; attempt <= MAX_OUTPUT_NAME_ATTEMPTS; attempt += 1) {
    const candidate =
      attempt === 1 ? baseOutputPath : join(parts.dir, `${parts.name} (${attempt})${parts.ext}`)
    if (reserved.has(normalizeFileIdentity(candidate))) continue
    try {
      await lstat(candidate)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new DocumentSafetyError('OUTPUT_EXISTS')
}

export async function assertOutputAvailable(outputPath: string): Promise<void> {
  try {
    await lstat(outputPath)
    throw new DocumentSafetyError('OUTPUT_EXISTS')
  } catch (error) {
    if (error instanceof DocumentSafetyError) throw error
    if (!(isNodeError(error) && error.code === 'ENOENT')) throw error
  }
}

export async function assertSafeTemporaryOutput(
  inputPath: string,
  outputPath: string
): Promise<void> {
  if (resolve(inputPath) === resolve(outputPath)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [inputInfo, outputInfo] = await Promise.all([
    lstat(inputPath, { bigint: true }),
    lstat(outputPath, { bigint: true })
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !inputInfo.isFile() ||
    inputInfo.isSymbolicLink() ||
    !outputInfo.isFile() ||
    outputInfo.isSymbolicLink() ||
    (inputInfo.dev === outputInfo.dev && inputInfo.ino === outputInfo.ino)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

export async function finalizeVerifiedOutput(options: {
  workspace: TemporaryWorkspace
  input: InputSnapshot
  temporaryPath: string
  outputPath: string
  verification: VerificationReport
  mode?: OutputMode
  outputDirectory?: string
  signal?: AbortSignal
}): Promise<PublishedFile> {
  const { workspace, input, temporaryPath, outputPath, signal } = options
  const mode = options.mode ?? 'suffix'
  assertTrustedWorkspace(workspace)
  await assertWorkspaceIdentities(workspace)
  throwIfAborted(signal)
  const verification = VerificationReportSchema.parse(options.verification)
  if (
    verification.status !== 'passed' ||
    verification.inputSha256 !== input.sha256 ||
    (verification.inputSha256s && !verification.inputSha256s.includes(input.sha256))
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  if (!workspace.contains(temporaryPath)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const expectedOutputDirectory = resolve(options.outputDirectory ?? workspace.outputDirectory)
  if (!(await sameRealPath(dirname(resolve(outputPath)), expectedOutputDirectory))) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  if (mode === 'overwrite' && !(await sameRealPath(resolve(outputPath), input.absolutePath))) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const temporaryInfo = await lstat(temporaryPath, { bigint: true })
  if (!temporaryInfo.isFile() || temporaryInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  await assertInputUnchanged(input, signal)
  const temporarySha256 = await sha256File(temporaryPath, signal)
  if (temporarySha256 !== verification.outputSha256) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const handle = await open(temporaryPath, 'r+')
  await handle.sync()
  await handle.close()

  return publishReservedWorkspaceFile({
    workspace,
    temporaryPath,
    outputPath,
    mode,
    outputDirectory: expectedOutputDirectory
  })
}

export async function publishReservedWorkspaceFile(options: {
  workspace: TemporaryWorkspace
  temporaryPath: string
  outputPath: string
  mode?: OutputMode
  outputDirectory?: string
}): Promise<PublishedFile> {
  const { workspace, temporaryPath, outputPath } = options
  const mode = options.mode ?? 'suffix'
  assertTrustedWorkspace(workspace)
  await assertWorkspaceIdentities(workspace)
  const expectedOutputDirectory = resolve(options.outputDirectory ?? workspace.outputDirectory)
  if (
    !workspace.contains(temporaryPath) ||
    !(await sameRealPath(dirname(resolve(outputPath)), expectedOutputDirectory))
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const temporaryInfo = await lstat(temporaryPath, { bigint: true })
  if (!temporaryInfo.isFile() || temporaryInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const identity = fileSystemIdentityFromBigInts(
    temporaryInfo.dev,
    temporaryInfo.ino,
    temporaryInfo.mode
  )

  if (mode === 'overwrite') {
    return publishVerifiedOverwrite(workspace, temporaryPath, resolve(outputPath), identity)
  }

  try {
    await link(temporaryPath, outputPath)
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new DocumentSafetyError('OUTPUT_EXISTS', error)
    }
    throw error
  }
  return { absolutePath: resolve(outputPath), identity }
}

/**
 * Replaces the input with the verified temporary file. The original bytes are
 * first hard-linked into the workspace so a later publication failure can
 * restore them, then the temporary file takes the input path in one atomic
 * rename. The input is never replaced before verification passed.
 */
async function publishVerifiedOverwrite(
  workspace: TemporaryWorkspace,
  temporaryPath: string,
  outputPath: string,
  identity: FileSystemIdentity
): Promise<PublishedFile> {
  const backupPath = join(
    workspace.rootPath,
    `${randomUUID()}-${basename(outputPath)}.original-backup`
  )
  await link(outputPath, backupPath)
  workspace.register(backupPath)
  try {
    await rename(temporaryPath, outputPath)
  } catch (error) {
    await unlink(backupPath).catch(() => undefined)
    throw error
  }
  return { absolutePath: outputPath, identity, backupPath }
}

/**
 * Re-attest a published hard link immediately before workspace cleanup.  The
 * final path must still be the exact task-owned inode and its bytes must match
 * the fresh verification report.  When `temporaryPath` is supplied, the
 * workspace link is checked too; after cleanup callers can attest the final
 * path again without a second writer.
 */
export async function attestPublishedFile(options: {
  published: PublishedFile
  expectedSha256: string
  temporaryPath?: string
  signal?: AbortSignal
}): Promise<void> {
  const { published, expectedSha256, temporaryPath, signal } = options
  await attestExactFile({
    absolutePath: published.absolutePath,
    expectedIdentity: published.identity,
    expectedSha256,
    ...(signal ? { signal } : {})
  })
  if (!temporaryPath) return
  await attestExactFile({
    absolutePath: temporaryPath,
    expectedIdentity: published.identity,
    expectedSha256,
    ...(signal ? { signal } : {})
  })
}

/** Proves one path's exact identity both before and after hashing its bytes. */
export async function attestExactFile(options: {
  absolutePath: string
  expectedIdentity: FileSystemIdentity
  expectedSha256: string
  signal?: AbortSignal
  afterHash?: () => void | Promise<void>
}): Promise<void> {
  const { absolutePath, expectedIdentity, expectedSha256, signal, afterHash } = options
  throwIfAborted(signal)
  const beforeHash = await lstat(absolutePath, { bigint: true }).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !beforeHash.isFile() ||
    beforeHash.isSymbolicLink() ||
    !sameFileSystemIdentity(
      fileSystemIdentityFromBigInts(beforeHash.dev, beforeHash.ino, beforeHash.mode),
      expectedIdentity
    )
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const actualSha256 = await sha256File(absolutePath, signal)
  await afterHash?.()
  if (actualSha256 !== expectedSha256) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const afterHashInfo = await lstat(absolutePath, { bigint: true }).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !afterHashInfo.isFile() ||
    afterHashInfo.isSymbolicLink() ||
    !sameFileSystemIdentity(
      fileSystemIdentityFromBigInts(afterHashInfo.dev, afterHashInfo.ino, afterHashInfo.mode),
      expectedIdentity
    ) ||
    afterHashInfo.size !== beforeHash.size ||
    afterHashInfo.mtimeNs !== beforeHash.mtimeNs ||
    afterHashInfo.ctimeNs !== beforeHash.ctimeNs
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

export async function rollbackPublishedFiles(files: readonly PublishedFile[]): Promise<void> {
  const failures: unknown[] = []
  for (const file of [...files].reverse()) {
    try {
      const current = await lstat(file.absolutePath, { bigint: true }).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return null
        throw error
      })
      if (current) {
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          !sameFileSystemIdentity(
            fileSystemIdentityFromBigInts(current.dev, current.ino, current.mode),
            file.identity
          )
        ) {
          throw new DocumentSafetyError('INTERNAL_ERROR')
        }
        await unlink(file.absolutePath)
      }
      if (file.backupPath) {
        // Overwrite mode: put the original input bytes back in place.
        await rename(file.backupPath, file.absolutePath)
      }
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new DocumentSafetyError('INTERNAL_ERROR', failures[0])
}

export async function cleanupTemporaryWorkspace(workspace: TemporaryWorkspace): Promise<void> {
  assertTrustedWorkspace(workspace)
  const rootPath = resolve(workspace.rootPath)
  const expectedParent = resolve(workspace.outputDirectory)
  if (
    normalizeFileIdentity(dirname(rootPath)) !== normalizeFileIdentity(expectedParent) ||
    !basename(rootPath).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    rootPath === expectedParent ||
    rootPath === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const currentRoot = await resolvePathIdentityWithoutSymbolicLinks(rootPath).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (!currentRoot) {
    TRUSTED_WORKSPACES.delete(workspace)
    return
  }
  const currentOutput = await resolvePathIdentityWithoutSymbolicLinks(expectedParent).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (
    normalizeFileIdentity(currentRoot.canonicalPath) !== normalizeFileIdentity(rootPath) ||
    normalizeFileIdentity(currentOutput.canonicalPath) !== normalizeFileIdentity(expectedParent) ||
    !sameFileSystemIdentity(currentRoot.identity, workspace.rootIdentity) ||
    !sameFileSystemIdentity(currentOutput.identity, workspace.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [rootInfo, outputInfo] = await Promise.all([
    lstat(currentRoot.canonicalPath),
    lstat(currentOutput.canonicalPath)
  ])
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink()
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [confirmedRoot, confirmedOutput] = await Promise.all([
    resolvePathIdentityWithoutSymbolicLinks(rootPath),
    resolvePathIdentityWithoutSymbolicLinks(expectedParent)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    normalizeFileIdentity(confirmedRoot.canonicalPath) !==
      normalizeFileIdentity(currentRoot.canonicalPath) ||
    normalizeFileIdentity(confirmedOutput.canonicalPath) !==
      normalizeFileIdentity(currentOutput.canonicalPath) ||
    !sameFileSystemIdentity(confirmedRoot.identity, workspace.rootIdentity) ||
    !sameFileSystemIdentity(confirmedOutput.identity, workspace.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  await rm(confirmedRoot.canonicalPath, { recursive: true, force: true })
  TRUSTED_WORKSPACES.delete(workspace)
}

export async function cleanupAbandonedTemporaryWorkspace(
  descriptorInput: TemporaryWorkspaceDescriptor
): Promise<void> {
  const descriptor = TemporaryWorkspaceDescriptorSchema.parse(descriptorInput)
  const rootPath = resolve(descriptor.rootPath)
  const outputDirectory = resolve(descriptor.outputDirectory)
  if (
    normalizeFileIdentity(dirname(rootPath)) !== normalizeFileIdentity(outputDirectory) ||
    !basename(rootPath).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    rootPath === outputDirectory ||
    rootPath === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const currentRoot = await resolvePathIdentityWithoutSymbolicLinks(rootPath).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (!currentRoot) {
    await rollbackDetachedJournaledHardLinks(descriptor)
    return
  }
  const currentOutput = await resolvePathIdentityWithoutSymbolicLinks(outputDirectory).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (
    normalizeFileIdentity(currentRoot.canonicalPath) !== normalizeFileIdentity(rootPath) ||
    normalizeFileIdentity(currentOutput.canonicalPath) !== normalizeFileIdentity(outputDirectory) ||
    !sameFileSystemIdentity(currentRoot.identity, descriptor.rootIdentity) ||
    !sameFileSystemIdentity(currentOutput.identity, descriptor.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [rootInfo, outputInfo] = await Promise.all([
    lstat(currentRoot.canonicalPath),
    lstat(currentOutput.canonicalPath)
  ])
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink()
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [confirmedRoot, confirmedOutput] = await Promise.all([
    resolvePathIdentityWithoutSymbolicLinks(rootPath),
    resolvePathIdentityWithoutSymbolicLinks(outputDirectory)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !sameFileSystemIdentity(confirmedRoot.identity, descriptor.rootIdentity) ||
    !sameFileSystemIdentity(confirmedOutput.identity, descriptor.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  // A process can terminate between hard-linking two final artifacts.  New
  // publication entries journal the exact temporary/final path pair and (once
  // linked) the expected inode/hash, so recovery can remove only task-owned
  // outputs.  Legacy sanitization entries have no publication list and are
  // intentionally not guessed at here.
  await rollbackJournaledHardLinks(
    descriptor.rootIdentity,
    descriptor.outputDirectoryIdentity,
    descriptor.publication?.artifacts ?? []
  )
  const [finalRoot, finalOutput] = await Promise.all([
    resolvePathIdentityWithoutSymbolicLinks(rootPath),
    resolvePathIdentityWithoutSymbolicLinks(outputDirectory)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    normalizeFileIdentity(finalRoot.canonicalPath) !== normalizeFileIdentity(rootPath) ||
    normalizeFileIdentity(finalOutput.canonicalPath) !== normalizeFileIdentity(outputDirectory) ||
    !sameFileSystemIdentity(finalRoot.identity, descriptor.rootIdentity) ||
    !sameFileSystemIdentity(finalOutput.identity, descriptor.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [finalRootInfo, finalOutputInfo] = await Promise.all([
    lstat(finalRoot.canonicalPath),
    lstat(finalOutput.canonicalPath)
  ])
  if (
    !finalRootInfo.isDirectory() ||
    finalRootInfo.isSymbolicLink() ||
    !finalOutputInfo.isDirectory() ||
    finalOutputInfo.isSymbolicLink()
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  await rm(finalRoot.canonicalPath, { recursive: true, force: true })
}

async function rollbackDetachedJournaledHardLinks(
  descriptor: TemporaryWorkspaceDescriptor
): Promise<void> {
  const artifacts = descriptor.publication?.artifacts ?? []
  if (artifacts.length === 0) return
  const outputDirectory = resolve(descriptor.outputDirectory)
  const currentOutput = await resolvePathIdentityWithoutSymbolicLinks(outputDirectory).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
  if (
    normalizeFileIdentity(currentOutput.canonicalPath) !== normalizeFileIdentity(outputDirectory) ||
    !sameFileSystemIdentity(currentOutput.identity, descriptor.outputDirectoryIdentity)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const outputInfo = await lstat(currentOutput.canonicalPath)
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  for (const artifact of artifacts) {
    const outputPath = resolve(artifact.outputPath)
    const outputParent = await resolvePathIdentityWithoutSymbolicLinks(dirname(outputPath)).catch(
      (error: unknown) => {
        throw new DocumentSafetyError('INTERNAL_ERROR', error)
      }
    )
    if (!sameFileSystemIdentity(outputParent.identity, currentOutput.identity)) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    if (!artifact.identity || !artifact.outputSha256) continue
    try {
      await attestExactFile({
        absolutePath: outputPath,
        expectedIdentity: artifact.identity,
        expectedSha256: artifact.outputSha256
      })
      await unlink(outputPath)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue
      if (error instanceof DocumentSafetyError) continue
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  }
}

async function rollbackJournaledHardLinks(
  workspaceRootIdentity: FileSystemIdentity,
  outputDirectoryIdentity: FileSystemIdentity,
  artifacts: readonly WorkspacePublicationArtifact[]
): Promise<void> {
  for (const artifact of artifacts) {
    const outputPath = resolve(artifact.outputPath)
    const temporaryPath = resolve(artifact.temporaryPath)
    const [outputParent, temporaryParent] = await Promise.all([
      resolvePathIdentityWithoutSymbolicLinks(dirname(outputPath)),
      resolvePathIdentityWithoutSymbolicLinks(dirname(temporaryPath))
    ]).catch((error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    })
    if (
      !sameFileSystemIdentity(outputParent.identity, outputDirectoryIdentity) ||
      !sameFileSystemIdentity(temporaryParent.identity, workspaceRootIdentity)
    ) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    const temporaryInfo = await lstat(temporaryPath, { bigint: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    })
    const outputInfo = await lstat(outputPath, { bigint: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    })
    if (!outputInfo) continue
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink()) continue
    if (!temporaryInfo || !temporaryInfo.isFile() || temporaryInfo.isSymbolicLink()) continue
    const outputIdentity = fileSystemIdentityFromBigInts(
      outputInfo.dev,
      outputInfo.ino,
      outputInfo.mode
    )
    const temporaryIdentity = fileSystemIdentityFromBigInts(
      temporaryInfo.dev,
      temporaryInfo.ino,
      temporaryInfo.mode
    )
    if (!sameFileSystemIdentity(outputIdentity, temporaryIdentity)) continue
    if (artifact.identity && !sameFileSystemIdentity(outputIdentity, artifact.identity)) continue
    if (artifact.outputSha256) {
      try {
        await attestExactFile({
          absolutePath: temporaryPath,
          expectedIdentity: outputIdentity,
          expectedSha256: artifact.outputSha256
        })
        await attestExactFile({
          absolutePath: outputPath,
          expectedIdentity: outputIdentity,
          expectedSha256: artifact.outputSha256
        })
      } catch {
        continue
      }
    }
    await unlink(outputPath)
  }
}

async function detectDocumentType(filePath: string, signal?: AbortSignal): Promise<DocumentType> {
  const extension = extname(filePath).toLowerCase()
  if (extension !== '.docx' && extension !== '.pdf') {
    throw new DocumentSafetyError('UNSUPPORTED_TYPE')
  }

  const handle = await open(filePath, 'r')
  const header = Buffer.alloc(5)
  try {
    await handle.read(header, 0, header.length, 0)
  } finally {
    await handle.close()
  }

  if (extension === '.pdf') {
    if (header.toString('ascii') !== '%PDF-') throw new DocumentSafetyError('INVALID_DOCUMENT')
    return 'pdf'
  }

  if (header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  await assertDocxPackageMarkers(filePath, signal)
  return 'docx'
}

async function assertDocxPackageMarkers(filePath: string, signal?: AbortSignal): Promise<void> {
  const markerNames = new Set(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
  const markerContents = new Map<string, Buffer>()

  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        rejectPromise(new DocumentSafetyError('INVALID_DOCUMENT', openError))
        return
      }

      const reject = (error: unknown): void => {
        zipFile.close()
        rejectPromise(
          error instanceof DocumentSafetyError
            ? error
            : new DocumentSafetyError('INVALID_DOCUMENT', error)
        )
      }

      zipFile.on('error', reject)
      zipFile.on('entry', (entry) => {
        try {
          throwIfAborted(signal)
          if (!markerNames.has(entry.fileName)) {
            zipFile.readEntry()
            return
          }
          if (entry.uncompressedSize > MAX_MARKER_XML_BYTES) {
            reject(new DocumentSafetyError('INVALID_DOCUMENT'))
            return
          }

          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              reject(streamError)
              return
            }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('error', reject)
            stream.on('end', () => {
              markerContents.set(entry.fileName, Buffer.concat(chunks))
              zipFile.readEntry()
            })
          })
        } catch (error) {
          reject(error)
        }
      })
      zipFile.on('end', () => {
        try {
          validateDocxMarkerXml(markerContents)
          resolvePromise()
        } catch (error) {
          reject(error)
        }
      })
      zipFile.readEntry()
    })
  })
}

function validateDocxMarkerXml(markerContents: ReadonlyMap<string, Buffer>): void {
  const contentTypesSource = markerContents.get('[Content_Types].xml')
  const relationshipsSource = markerContents.get('_rels/.rels')
  if (!contentTypesSource || !relationshipsSource || !markerContents.has('word/document.xml')) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const parser = new DOMParser({ onError: onWarningStopParsing })
  const contentTypes = parser.parseFromString(
    contentTypesSource.toString('utf8'),
    'application/xml'
  )
  const overrides = Array.from(contentTypes.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'))
  const hasWordMainType = overrides.some(
    (node) =>
      node.getAttribute('PartName') === '/word/document.xml' &&
      node.getAttribute('ContentType') ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  )

  const relationships = parser.parseFromString(
    relationshipsSource.toString('utf8'),
    'application/xml'
  )
  const relationshipNodes = Array.from(
    relationships.getElementsByTagNameNS(RELATIONSHIPS_NS, 'Relationship')
  )
  const officeDocumentRelationships = relationshipNodes.filter(
    (node) => node.getAttribute('Type')?.endsWith('/officeDocument') === true
  )
  const hasOfficeDocumentRelationship = officeDocumentRelationships.some(
    (node) =>
      node.getAttribute('Target')?.replace(/^\//u, '') === 'word/document.xml' &&
      node.getAttribute('TargetMode') !== 'External'
  )

  if (
    contentTypes.documentElement?.namespaceURI !== CONTENT_TYPES_NS ||
    contentTypes.documentElement.localName !== 'Types' ||
    relationships.documentElement?.namespaceURI !== RELATIONSHIPS_NS ||
    relationships.documentElement.localName !== 'Relationships' ||
    !hasWordMainType ||
    officeDocumentRelationships.length !== 1 ||
    !hasOfficeDocumentRelationship
  ) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
}

function assertTrustedWorkspace(workspace: TemporaryWorkspace): void {
  if (!TRUSTED_WORKSPACES.has(workspace)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

async function assertWorkspaceIdentities(workspace: TemporaryWorkspace): Promise<void> {
  const [root, outputDirectory] = await Promise.all([
    resolvePathIdentityWithoutSymbolicLinks(workspace.rootPath),
    resolvePathIdentityWithoutSymbolicLinks(workspace.outputDirectory)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  const [rootInfo, outputInfo] = await Promise.all([
    lstat(root.canonicalPath),
    lstat(outputDirectory.canonicalPath)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    normalizeFileIdentity(root.canonicalPath) !== normalizeFileIdentity(workspace.rootPath) ||
    normalizeFileIdentity(outputDirectory.canonicalPath) !==
      normalizeFileIdentity(workspace.outputDirectory) ||
    !sameFileSystemIdentity(root.identity, workspace.rootIdentity) ||
    !sameFileSystemIdentity(outputDirectory.identity, workspace.outputDirectoryIdentity) ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink()
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

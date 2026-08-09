import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, link, mkdtemp, open, realpath, rm, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve, sep, win32 } from 'node:path'
import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom'
import * as yauzl from 'yauzl'
import {
  InputSnapshotSchema,
  VerificationReportSchema,
  createAppError,
  type AppError,
  type AppErrorCode,
  type DocumentType,
  type InputSnapshot,
  type VerificationReport
} from '../../shared/contracts'

export const MAX_INPUT_BYTES = 200 * 1024 * 1024
const MAX_MARKER_XML_BYTES = 1024 * 1024
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TEMPORARY_DIRECTORY_PREFIX = '.bid-sentry-tmp-'
const TRUSTED_WORKSPACES = new WeakSet<TemporaryWorkspace>()

export class DocumentSafetyError extends Error {
  readonly appError: AppError

  constructor(code: AppErrorCode, cause?: unknown) {
    const appError = createAppError(code)
    super(appError.message, cause === undefined ? undefined : { cause })
    this.name = 'DocumentSafetyError'
    this.appError = appError
  }
}

export class TemporaryWorkspace {
  readonly #reservedPaths = new Set<string>()

  constructor(
    readonly rootPath: string,
    readonly outputDirectory: string
  ) {}

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
  device: number
  inode: number
}

export async function createInputSnapshot(
  inputPath: string,
  signal?: AbortSignal
): Promise<InputSnapshot> {
  throwIfAborted(signal)
  const absolutePath = resolve(inputPath)
  const fileInfo = await lstat(absolutePath).catch((error: unknown) => {
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  })

  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const canonicalPath = await realpath(absolutePath)
  if (normalizeFileIdentity(canonicalPath) !== normalizeFileIdentity(absolutePath)) {
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
  const current = await lstat(snapshot.absolutePath).catch((error: unknown) => {
    throw new DocumentSafetyError('FILE_CHANGED', error)
  })

  if (!current.isFile() || current.isSymbolicLink()) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
  const canonicalPath = await realpath(snapshot.absolutePath)
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
  const stream = createReadStream(filePath)

  try {
    for await (const chunk of stream) {
      throwIfAborted(signal)
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  } catch (error) {
    stream.destroy()
    if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
    throw error
  }
}

export async function createTemporaryWorkspace(
  outputDirectory: string
): Promise<TemporaryWorkspace> {
  const resolvedOutput = resolve(outputDirectory)
  const outputInfo = await lstat(resolvedOutput).catch((error: unknown) => {
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  })
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const canonicalOutput = await realpath(resolvedOutput)
  if (normalizeFileIdentity(canonicalOutput) !== normalizeFileIdentity(resolvedOutput)) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const rootPath = await mkdtemp(join(resolvedOutput, TEMPORARY_DIRECTORY_PREFIX))
  const workspace = new TemporaryWorkspace(rootPath, resolvedOutput)
  TRUSTED_WORKSPACES.add(workspace)
  return workspace
}

export async function adoptTemporaryWorkspace(
  rootPath: string,
  outputDirectory: string
): Promise<TemporaryWorkspace> {
  const resolvedRoot = resolve(rootPath)
  const resolvedOutput = resolve(outputDirectory)
  if (
    dirname(resolvedRoot) !== resolvedOutput ||
    !basename(resolvedRoot).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    resolvedRoot === resolvedOutput ||
    resolvedRoot === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const [rootInfo, outputInfo, canonicalRoot, canonicalOutput] = await Promise.all([
    lstat(resolvedRoot),
    lstat(resolvedOutput),
    realpath(resolvedRoot),
    realpath(resolvedOutput)
  ]).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink() ||
    normalizeFileIdentity(canonicalRoot) !== normalizeFileIdentity(resolvedRoot) ||
    normalizeFileIdentity(canonicalOutput) !== normalizeFileIdentity(resolvedOutput)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const workspace = new TemporaryWorkspace(resolvedRoot, resolvedOutput)
  TRUSTED_WORKSPACES.add(workspace)
  return workspace
}

export async function reserveTemporaryFile(
  workspace: TemporaryWorkspace,
  displayName: string
): Promise<string> {
  assertTrustedWorkspace(workspace)
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

export function buildSanitizedOutputPath(inputPath: string, outputDirectory: string): string {
  const parts = parse(basename(inputPath))
  return join(resolve(outputDirectory), `${parts.name}_sanitized${parts.ext.toLowerCase()}`)
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
  const [inputInfo, outputInfo] = await Promise.all([lstat(inputPath), lstat(outputPath)]).catch(
    (error: unknown) => {
      throw new DocumentSafetyError('INTERNAL_ERROR', error)
    }
  )
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
  signal?: AbortSignal
}): Promise<PublishedFile> {
  const { workspace, input, temporaryPath, outputPath, signal } = options
  assertTrustedWorkspace(workspace)
  throwIfAborted(signal)
  const verification = VerificationReportSchema.parse(options.verification)
  if (verification.status !== 'passed' || verification.inputSha256 !== input.sha256) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  if (!workspace.contains(temporaryPath)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  if (
    normalizeFileIdentity(dirname(resolve(outputPath))) !==
    normalizeFileIdentity(workspace.outputDirectory)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const outputDirectoryInfo = await lstat(workspace.outputDirectory)
  const canonicalOutputDirectory = await realpath(workspace.outputDirectory)
  if (
    !outputDirectoryInfo.isDirectory() ||
    outputDirectoryInfo.isSymbolicLink() ||
    normalizeFileIdentity(canonicalOutputDirectory) !==
      normalizeFileIdentity(workspace.outputDirectory)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const temporaryInfo = await lstat(temporaryPath)
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

  return publishReservedWorkspaceFile({ workspace, temporaryPath, outputPath })
}

export async function publishReservedWorkspaceFile(options: {
  workspace: TemporaryWorkspace
  temporaryPath: string
  outputPath: string
}): Promise<PublishedFile> {
  const { workspace, temporaryPath, outputPath } = options
  assertTrustedWorkspace(workspace)
  if (
    !workspace.contains(temporaryPath) ||
    normalizeFileIdentity(dirname(resolve(outputPath))) !==
      normalizeFileIdentity(workspace.outputDirectory)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const temporaryInfo = await lstat(temporaryPath)
  if (!temporaryInfo.isFile() || temporaryInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  try {
    await link(temporaryPath, outputPath)
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new DocumentSafetyError('OUTPUT_EXISTS', error)
    }
    throw error
  }
  return {
    absolutePath: resolve(outputPath),
    device: temporaryInfo.dev,
    inode: temporaryInfo.ino
  }
}

export async function rollbackPublishedFiles(files: readonly PublishedFile[]): Promise<void> {
  const failures: unknown[] = []
  for (const file of [...files].reverse()) {
    try {
      const current = await lstat(file.absolutePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return null
        throw error
      })
      if (!current) continue
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.dev !== file.device ||
        current.ino !== file.inode
      ) {
        throw new DocumentSafetyError('INTERNAL_ERROR')
      }
      await unlink(file.absolutePath)
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
    dirname(rootPath) !== expectedParent ||
    !basename(rootPath).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    rootPath === expectedParent ||
    rootPath === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const rootInfo = await lstat(rootPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  })
  if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  await rm(rootPath, { recursive: true, force: true })
  TRUSTED_WORKSPACES.delete(workspace)
}

export async function cleanupAbandonedTemporaryWorkspace(
  rootPath: string,
  outputDirectory: string
): Promise<void> {
  const resolvedRoot = resolve(rootPath)
  const resolvedOutput = resolve(outputDirectory)
  if (
    dirname(resolvedRoot) !== resolvedOutput ||
    !basename(resolvedRoot).startsWith(TEMPORARY_DIRECTORY_PREFIX) ||
    resolvedRoot === resolvedOutput ||
    resolvedRoot === resolve(sep)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const rootInfo = await lstat(resolvedRoot).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (!rootInfo) return
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }

  const outputInfo = await lstat(resolvedOutput).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  const canonicalOutput = await realpath(resolvedOutput).catch((error: unknown) => {
    throw new DocumentSafetyError('INTERNAL_ERROR', error)
  })
  if (
    !outputInfo.isDirectory() ||
    outputInfo.isSymbolicLink() ||
    normalizeFileIdentity(canonicalOutput) !== normalizeFileIdentity(resolvedOutput)
  ) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  await rm(resolvedRoot, { recursive: true, force: true })
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

export function normalizeFileIdentity(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const normalized = platform === 'win32' ? win32.resolve(filePath) : resolve(filePath)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function assertTrustedWorkspace(workspace: TemporaryWorkspace): void {
  if (!TRUSTED_WORKSPACES.has(workspace)) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

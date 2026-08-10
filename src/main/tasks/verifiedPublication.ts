import { copyFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  VerificationReportSchema,
  type InputSnapshot,
  type TemporaryWorkspaceDescriptor,
  type VerificationCheck,
  type VerificationReport
} from '../../shared/contracts'
import {
  attestPublishedFile,
  assertInputUnchanged,
  assertOutputAvailable,
  cleanupTemporaryWorkspace,
  createInputSnapshot,
  createTemporaryWorkspace,
  finalizeVerifiedOutput,
  reserveTemporaryFile,
  rollbackPublishedFiles,
  sha256File,
  type PublishedFile,
  type TemporaryWorkspace
} from '../../core/documents/fileSafety'
import { DocumentSafetyError } from '../../core/documents/fileSafety'
import type { FileSystemIdentity } from '../../shared/contracts'

export interface VerifiedPublicationArtifact {
  outputPath: string
  temporaryPath: string
  verification: VerificationReport
}

export interface VerifiedPublicationContext {
  workspace: TemporaryWorkspace
  temporaryPaths: readonly string[]
  outputPaths: readonly string[]
}

/**
 * Main-owned two-phase publication for review/generation outputs. Writers only
 * receive workspace paths. Final names are hard-linked after fresh checks and
 * the workspace is cleaned before the operation resolves.
 */
export async function publishVerifiedArtifacts<T>(options: {
  outputDirectory: string
  outputDirectoryIdentity: FileSystemIdentity
  inputs: readonly InputSnapshot[]
  outputNames: readonly string[]
  signal?: AbortSignal
  recordWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  forgetWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  write: (context: VerifiedPublicationContext) => Promise<T>
  verify: (
    context: VerifiedPublicationContext,
    value: T
  ) => Promise<readonly (readonly VerificationCheck[])[]>
}): Promise<{ value: T; artifacts: VerifiedPublicationArtifact[] }> {
  const outputDirectory = resolve(options.outputDirectory)
  if (options.inputs.length === 0) throw new DocumentSafetyError('INVALID_REQUEST')
  const outputNames = [...options.outputNames]
  if (
    outputNames.length === 0 ||
    outputNames.length > 20 ||
    outputNames.some((name) => !name || name === '.' || name === '..' || name !== basename(name)) ||
    new Set(outputNames).size !== outputNames.length
  ) {
    throw new DocumentSafetyError('INVALID_REQUEST')
  }
  await Promise.all(outputNames.map((name) => assertOutputAvailable(join(outputDirectory, name))))
  await assertInputsUnchanged(options.inputs, options.signal)
  const workspace = await createTemporaryWorkspace(outputDirectory, options.outputDirectoryIdentity)
  const outputPaths = outputNames.map((name) => join(workspace.outputDirectory, name))
  const journalManaged = Boolean(options.recordWorkspace)
  let descriptor: TemporaryWorkspaceDescriptor = {
    rootPath: workspace.rootPath,
    outputDirectory: workspace.outputDirectory,
    rootIdentity: workspace.rootIdentity,
    outputDirectoryIdentity: workspace.outputDirectoryIdentity
  }
  try {
    await options.recordWorkspace?.(descriptor)
  } catch (error) {
    let cleanupError: unknown
    try {
      await cleanupTemporaryWorkspace(workspace)
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure
    }
    let forgetError: unknown
    if (!cleanupError && journalManaged) {
      try {
        await options.forgetWorkspace?.(descriptor)
      } catch (forgetFailure) {
        forgetError = forgetFailure
      }
    }
    if (cleanupError || forgetError) throw publicationError(error, cleanupError ?? forgetError)
    throw error
  }
  let temporaryPaths: string[]
  try {
    temporaryPaths = await Promise.all(
      outputNames.map((name) => reserveTemporaryFile(workspace, name))
    )
  } catch (error) {
    let cleanupError: unknown
    try {
      await cleanupTemporaryWorkspace(workspace)
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure
    }
    let forgetError: unknown
    if (!cleanupError && journalManaged) {
      try {
        await options.forgetWorkspace?.(descriptor)
      } catch (forgetFailure) {
        forgetError = forgetFailure
      }
    }
    if (cleanupError || forgetError) throw publicationError(error, cleanupError ?? forgetError)
    throw error
  }
  descriptor = {
    ...descriptor,
    publication: {
      artifacts: temporaryPaths.map((temporaryPath, index) => ({
        temporaryPath,
        outputPath: outputPaths[index] as string
      }))
    }
  }
  try {
    await options.recordWorkspace?.(descriptor)
  } catch (error) {
    let cleanupError: unknown
    try {
      await cleanupTemporaryWorkspace(workspace)
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure
    }
    let forgetError: unknown
    if (!cleanupError && journalManaged) {
      try {
        await options.forgetWorkspace?.(descriptor)
      } catch (forgetFailure) {
        forgetError = forgetFailure
      }
    }
    if (cleanupError || forgetError) throw publicationError(error, cleanupError ?? forgetError)
    throw error
  }
  const context: VerifiedPublicationContext = { workspace, temporaryPaths, outputPaths }
  const published: PublishedFile[] = []
  let artifacts: VerifiedPublicationArtifact[] = []
  let cleaned = false
  try {
    const value = await options.write(context)
    await assertInputsUnchanged(options.inputs, options.signal)
    const checksByArtifact = await options.verify(context, value)
    if (checksByArtifact.length !== temporaryPaths.length) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    artifacts = []
    for (const [index, temporaryPath] of temporaryPaths.entries()) {
      const checks = checksByArtifact[index]
      if (!checks || checks.length === 0 || checks.some((check) => check.status !== 'passed')) {
        throw new DocumentSafetyError('INTERNAL_ERROR')
      }
      const outputSha256 = await sha256File(temporaryPath, options.signal)
      const verification = VerificationReportSchema.parse({
        schemaVersion: 1,
        status: 'passed',
        checks,
        inputSha256: options.inputs[0]!.sha256,
        inputSha256s: options.inputs.map((input) => input.sha256),
        outputSha256
      })
      artifacts.push({
        outputPath: outputPaths[index] as string,
        temporaryPath,
        verification
      })
    }
    descriptor = {
      ...descriptor,
      publication: {
        artifacts: descriptor.publication!.artifacts.map((candidate, index) => ({
          ...candidate,
          outputSha256: artifacts[index]!.verification.outputSha256
        }))
      }
    }
    await options.recordWorkspace?.(descriptor)
    for (const [index, artifact] of artifacts.entries()) {
      await assertInputsUnchanged(options.inputs, options.signal)
      const publishedFile = await finalizeVerifiedOutput({
        workspace,
        input: options.inputs[0]!,
        temporaryPath: artifact.temporaryPath,
        outputPath: artifact.outputPath,
        verification: artifact.verification,
        ...(options.signal ? { signal: options.signal } : {})
      })
      published.push(publishedFile)
      descriptor = withPublishedIdentity(descriptor, index, publishedFile.identity)
      await options.recordWorkspace?.(descriptor)
      await attestPublishedFile({
        published: publishedFile,
        expectedSha256: artifact.verification.outputSha256,
        temporaryPath: artifact.temporaryPath,
        ...(options.signal ? { signal: options.signal } : {})
      })
    }
    await attestPublications(published, artifacts, true, options.signal)
    await cleanupTemporaryWorkspace(workspace)
    cleaned = true
    await attestPublications(published, artifacts, false, options.signal)
    if (journalManaged) await options.forgetWorkspace?.(descriptor)
    return { value, artifacts }
  } catch (error) {
    let rollbackError: unknown
    try {
      await attestAndRollbackPublications(published, artifacts, !cleaned)
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure
    }
    let cleanupError: unknown
    let cleanupSucceeded = cleaned
    if (!cleaned && !rollbackError) {
      try {
        await cleanupTemporaryWorkspace(workspace)
        cleanupSucceeded = true
      } catch (cleanupFailure) {
        cleanupError = cleanupFailure
      }
    }
    let forgetError: unknown
    if (journalManaged && cleanupSucceeded && !rollbackError && !cleanupError && !cleaned) {
      try {
        await options.forgetWorkspace?.(descriptor)
      } catch (forgetFailure) {
        forgetError = forgetFailure
      }
    }
    if (rollbackError || cleanupError || forgetError) {
      throw publicationError(error, rollbackError ?? cleanupError ?? forgetError)
    }
    throw error
  }
}

function withPublishedIdentity(
  descriptor: TemporaryWorkspaceDescriptor,
  index: number,
  identity: FileSystemIdentity
): TemporaryWorkspaceDescriptor {
  if (!descriptor.publication?.artifacts[index]) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  return {
    ...descriptor,
    publication: {
      artifacts: descriptor.publication.artifacts.map((artifact, artifactIndex) =>
        artifactIndex === index ? { ...artifact, identity } : artifact
      )
    }
  }
}

async function attestPublications(
  published: readonly PublishedFile[],
  artifacts: readonly VerifiedPublicationArtifact[],
  includeTemporaryPath: boolean,
  signal?: AbortSignal
): Promise<void> {
  if (published.length !== artifacts.length) throw new DocumentSafetyError('INTERNAL_ERROR')
  for (const [index, file] of published.entries()) {
    const artifact = artifacts[index]!
    await attestPublishedFile({
      published: file,
      expectedSha256: artifact.verification.outputSha256,
      ...(includeTemporaryPath ? { temporaryPath: artifact.temporaryPath } : {}),
      ...(signal ? { signal } : {})
    })
  }
}

async function attestAndRollbackPublications(
  published: readonly PublishedFile[],
  artifacts: readonly VerifiedPublicationArtifact[],
  includeTemporaryPath: boolean
): Promise<void> {
  const failures: unknown[] = []
  for (let index = published.length - 1; index >= 0; index -= 1) {
    const file = published[index]!
    const artifact = artifacts[index]
    if (!artifact) {
      failures.push(new DocumentSafetyError('INTERNAL_ERROR'))
      continue
    }
    try {
      await attestPublishedFile({
        published: file,
        expectedSha256: artifact.verification.outputSha256,
        ...(includeTemporaryPath ? { temporaryPath: artifact.temporaryPath } : {})
      })
    } catch (error) {
      failures.push(error)
      continue
    }
    try {
      await rollbackPublishedFiles([file])
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw new DocumentSafetyError('INTERNAL_ERROR', new AggregateError(failures))
  }
}

async function assertInputsUnchanged(
  inputs: readonly InputSnapshot[],
  signal?: AbortSignal
): Promise<void> {
  for (const input of inputs) await assertInputUnchanged(input, signal)
}

function publicationError(primary: unknown, secondary?: unknown): DocumentSafetyError {
  return new DocumentSafetyError(
    'INTERNAL_ERROR',
    secondary === undefined ? primary : new AggregateError([primary, secondary])
  )
}

/**
 * Freeze the selected input bytes inside the task-owned workspace. The source
 * snapshot is checked both before and after the copy; consumers then read only
 * the frozen copy, eliminating a path TOCTOU window.
 */
export async function copyInputToWorkspace(
  workspace: TemporaryWorkspace,
  input: InputSnapshot,
  signal?: AbortSignal
): Promise<{ path: string; snapshot: InputSnapshot }> {
  await assertInputUnchanged(input, signal)
  const path = await reserveTemporaryFile(workspace, `input-${basename(input.displayName)}`)
  await copyFile(input.absolutePath, path)
  await assertInputUnchanged(input, signal)
  const snapshot = await createInputSnapshot(path, signal)
  if (snapshot.sha256 !== input.sha256) throw new DocumentSafetyError('FILE_CHANGED')
  return { path, snapshot }
}

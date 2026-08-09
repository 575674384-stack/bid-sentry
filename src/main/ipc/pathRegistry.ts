import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import {
  SanitizationTaskResultSchema,
  SelectedInputFilesSchema,
  SelectedOutputDirectorySchema,
  type InputSnapshot,
  type FileSystemIdentity,
  type SanitizationTaskResult,
  type SelectedInputFiles,
  type SelectedOutputDirectory,
  type WorkerExecutionResult
} from '../../shared/contracts'
import { DocumentSafetyError } from '../../core/documents/fileSafety'
import { resolvePathIdentityWithoutSymbolicLinks } from '../../core/documents/pathSafety'

interface OwnedInput {
  ownerId: number
  snapshot: InputSnapshot
}

interface OwnedOutputDirectory {
  ownerId: number
  absolutePath: string
  identity: FileSystemIdentity
}

interface OwnedResultFile {
  ownerId: number
  absolutePath: string
}

export class PathRegistry {
  readonly #inputs = new Map<string, OwnedInput>()
  readonly #outputDirectories = new Map<string, OwnedOutputDirectory>()
  readonly #resultFiles = new Map<string, OwnedResultFile>()

  registerInputs(ownerId: number, snapshots: readonly InputSnapshot[]): SelectedInputFiles {
    const files = snapshots.map((snapshot) => {
      const inputId = randomUUID()
      this.#inputs.set(inputId, { ownerId, snapshot })
      return {
        inputId,
        displayName: snapshot.displayName,
        documentType: snapshot.documentType,
        size: snapshot.size
      }
    })
    return SelectedInputFilesSchema.parse({ schemaVersion: 1, files })
  }

  resolveInputs(
    ownerId: number,
    inputIds: readonly string[]
  ): Array<{ inputId: string; snapshot: InputSnapshot }> {
    if (new Set(inputIds).size !== inputIds.length) {
      throw new DocumentSafetyError('INVALID_REQUEST')
    }
    return inputIds.map((inputId) => ({
      inputId,
      snapshot: this.#owned(this.#inputs, inputId, ownerId).snapshot
    }))
  }

  async registerOutputDirectory(
    ownerId: number,
    directoryPath: string
  ): Promise<SelectedOutputDirectory> {
    const resolvedDirectory = await resolvePathIdentityWithoutSymbolicLinks(directoryPath).catch(
      (error: unknown) => {
        throw new DocumentSafetyError('INVALID_DOCUMENT', error)
      }
    )
    const absolutePath = resolvedDirectory.canonicalPath
    const info = await lstat(absolutePath).catch((error: unknown) => {
      throw new DocumentSafetyError('INVALID_DOCUMENT', error)
    })
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }

    const outputDirectoryId = randomUUID()
    this.#outputDirectories.set(outputDirectoryId, {
      ownerId,
      absolutePath,
      identity: resolvedDirectory.identity
    })
    return SelectedOutputDirectorySchema.parse({
      schemaVersion: 1,
      outputDirectoryId,
      displayName: basename(absolutePath)
    })
  }

  resolveOutputDirectory(
    ownerId: number,
    outputDirectoryId: string
  ): { absolutePath: string; identity: FileSystemIdentity } {
    const entry = this.#owned(this.#outputDirectories, outputDirectoryId, ownerId)
    return { absolutePath: entry.absolutePath, identity: entry.identity }
  }

  registerTaskResult(
    ownerId: number,
    outputDirectory: string,
    result: WorkerExecutionResult
  ): SanitizationTaskResult {
    const expectedDirectory = resolve(outputDirectory)
    const paths = [
      ...result.outputPaths.map((absolutePath, index) => ({
        absolutePath,
        displayName: result.report.files[index]?.outputDisplayName ?? '',
        kind: 'sanitized-document' as const
      })),
      {
        absolutePath: result.jsonReportPath,
        displayName: basename(result.jsonReportPath),
        kind: 'json-report' as const
      },
      {
        absolutePath: result.htmlReportPath,
        displayName: basename(result.htmlReportPath),
        kind: 'html-report' as const
      }
    ]

    if (
      paths.some(
        (file) =>
          !file.displayName ||
          dirname(resolve(file.absolutePath)) !== expectedDirectory ||
          basename(file.absolutePath) !== file.displayName
      )
    ) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }

    const files = paths.map((file) => {
      const fileId = randomUUID()
      this.#resultFiles.set(fileId, { ownerId, absolutePath: resolve(file.absolutePath) })
      return { fileId, displayName: file.displayName, kind: file.kind }
    })
    return SanitizationTaskResultSchema.parse({
      schemaVersion: 1,
      taskId: result.taskId,
      report: result.report,
      files
    })
  }

  resolveResultFile(ownerId: number, fileId: string): string {
    return this.#owned(this.#resultFiles, fileId, ownerId).absolutePath
  }

  revokeOwner(ownerId: number): void {
    revokeOwned(this.#inputs, ownerId)
    revokeOwned(this.#outputDirectories, ownerId)
    revokeOwned(this.#resultFiles, ownerId)
  }

  #owned<T extends { ownerId: number }>(registry: Map<string, T>, id: string, ownerId: number): T {
    const entry = registry.get(id)
    if (!entry || entry.ownerId !== ownerId) throw new DocumentSafetyError('INVALID_REQUEST')
    return entry
  }
}

function revokeOwned<T extends { ownerId: number }>(
  registry: Map<string, T>,
  ownerId: number
): void {
  for (const [id, entry] of registry) {
    if (entry.ownerId === ownerId) registry.delete(id)
  }
}

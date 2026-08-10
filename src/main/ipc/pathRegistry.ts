import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import {
  SanitizationTaskResultSchema,
  SelectedInputFilesSchema,
  type InputSnapshot,
  type SanitizationTaskResult,
  type SelectedInputFiles,
  type WorkerExecutionResult,
  ReviewResultSchema,
  GenerationResultSchema,
  type ReviewResult,
  type GenerationResult
} from '../../shared/contracts'
import { DocumentSafetyError } from '../../core/documents/fileSafety'

interface OwnedInput {
  ownerId: number
  snapshot: InputSnapshot
}

interface OwnedResultFile {
  ownerId: number
  absolutePath: string
}

export class PathRegistry {
  readonly #inputs = new Map<string, OwnedInput>()
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

  /**
   * Registers sanitizer outputs for "show in folder". Every document output
   * must live in its own input's directory (per-input order), and the two
   * reports in the first input's directory — this is what keeps an absolute
   * path capability from ever pointing somewhere the user did not pick.
   */
  registerTaskResult(
    ownerId: number,
    inputDirectories: readonly string[],
    result: WorkerExecutionResult
  ): SanitizationTaskResult {
    const expectedDirectories = inputDirectories.map((directory) => resolve(directory))
    const reportDirectory = expectedDirectories[0]
    if (!reportDirectory || expectedDirectories.length !== result.outputPaths.length) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    const paths = [
      ...result.outputPaths.map((absolutePath, index) => ({
        absolutePath,
        displayName: result.report.files[index]?.outputDisplayName ?? '',
        expectedDirectory: expectedDirectories[index] as string,
        kind: 'sanitized-document' as const
      })),
      {
        absolutePath: result.jsonReportPath,
        displayName: basename(result.jsonReportPath),
        expectedDirectory: reportDirectory,
        kind: 'json-report' as const
      },
      {
        absolutePath: result.htmlReportPath,
        displayName: basename(result.htmlReportPath),
        expectedDirectory: reportDirectory,
        kind: 'html-report' as const
      }
    ]

    if (
      paths.some(
        (file) =>
          !file.displayName ||
          dirname(resolve(file.absolutePath)) !== file.expectedDirectory ||
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

  registerReviewResult(
    ownerId: number,
    outputDirectory: string,
    result: ReviewResult
  ): ReviewResult {
    const expectedDirectory = resolve(outputDirectory)
    const files = [
      this.registerResultPath(ownerId, expectedDirectory, result.jsonReport, 'json-report'),
      this.registerResultPath(ownerId, expectedDirectory, result.htmlReport, 'html-report')
    ]
    return ReviewResultSchema.parse({ ...result, files })
  }

  registerGenerationResult(
    ownerId: number,
    outputDirectory: string,
    result: GenerationResult
  ): GenerationResult {
    const expectedDirectory = resolve(outputDirectory)
    const files = [
      this.registerResultPath(ownerId, expectedDirectory, result.outputName, 'generated-document'),
      this.registerResultPath(ownerId, expectedDirectory, result.reportName, 'json-report')
    ]
    return GenerationResultSchema.parse({ ...result, files })
  }

  resolveResultFile(ownerId: number, fileId: string): string {
    return this.#owned(this.#resultFiles, fileId, ownerId).absolutePath
  }

  revokeOwner(ownerId: number): void {
    revokeOwned(this.#inputs, ownerId)
    revokeOwned(this.#resultFiles, ownerId)
  }

  #owned<T extends { ownerId: number }>(registry: Map<string, T>, id: string, ownerId: number): T {
    const entry = registry.get(id)
    if (!entry || entry.ownerId !== ownerId) throw new DocumentSafetyError('INVALID_REQUEST')
    return entry
  }

  private registerResultPath(
    ownerId: number,
    expectedDirectory: string,
    displayName: string,
    kind: 'json-report' | 'html-report' | 'generated-document'
  ) {
    const absolutePath = resolve(expectedDirectory, displayName)
    if (
      !displayName ||
      basename(absolutePath) !== displayName ||
      dirname(absolutePath) !== expectedDirectory
    ) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    const fileId = randomUUID()
    this.#resultFiles.set(fileId, { ownerId, absolutePath })
    return { fileId, displayName, kind }
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

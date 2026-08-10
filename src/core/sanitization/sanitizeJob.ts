import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type {
  DocumentType,
  FileSystemIdentity,
  InputSnapshot,
  SanitizationPreview,
  TaskProgress,
  VerificationReport,
  WorkerExecutionResult,
  WorkerPreviewRequest
} from '../../shared/contracts'
import {
  SanitizationPreviewSchema,
  TaskProgressSchema,
  WorkerExecutionResultSchema
} from '../../shared/contracts'
import type {
  DocumentAdapter,
  DocumentInspection,
  DocumentSanitizationPlan
} from '../documents/documentAdapter'
import { docxDocumentAdapter } from '../documents/docx'
import {
  DocumentSafetyError,
  adoptTemporaryWorkspace,
  assertInputUnchanged,
  assertOutputAvailable,
  buildSanitizedOutputPath,
  cleanupTemporaryWorkspace,
  createTemporaryWorkspace,
  finalizeVerifiedOutput,
  normalizeFileIdentity,
  rollbackPublishedFiles,
  type PublishedFile,
  reserveTemporaryFile
} from '../documents/fileSafety'
import { pdfDocumentAdapter } from '../documents/pdf'
import {
  assertPublicSanitizationResultFits,
  buildCompletedReport,
  buildReportPaths,
  publishSanitizationReportFiles
} from './sanitizeResult'
import { aggregateVerification } from './verificationSummary'

type PreviewFile = SanitizationPreview['files'][number]
type ProgressSink = (progress: TaskProgress) => void
type CommonAdapter = DocumentAdapter<DocumentInspection, DocumentSanitizationPlan>

interface PlannedFile {
  inputId: string
  snapshot: InputSnapshot
  inspection: DocumentInspection
  plan: DocumentSanitizationPlan
}

interface StoredPreview {
  preview: SanitizationPreview
  plannedFiles: PlannedFile[]
  expiresAtMs: number
  executing: boolean
}

export interface SanitizationJobOptions {
  adapters?: Readonly<Record<DocumentType, CommonAdapter>>
  now?: () => Date
  previewTtlMs?: number
}

const DEFAULT_PREVIEW_TTL_MS = 30 * 60 * 1000
const DEFAULT_ADAPTERS: Readonly<Record<DocumentType, CommonAdapter>> = Object.freeze({
  docx: docxDocumentAdapter as unknown as CommonAdapter,
  pdf: pdfDocumentAdapter as unknown as CommonAdapter
})

export class SanitizationJob {
  readonly #adapters: Readonly<Record<DocumentType, CommonAdapter>>
  readonly #now: () => Date
  readonly #previewTtlMs: number
  readonly #previews = new Map<string, StoredPreview>()

  constructor(options: SanitizationJobOptions = {}) {
    this.#adapters = options.adapters ?? DEFAULT_ADAPTERS
    this.#now = options.now ?? (() => new Date())
    this.#previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS
  }

  async preview(
    request: WorkerPreviewRequest,
    signal: AbortSignal,
    onProgress?: ProgressSink
  ): Promise<SanitizationPreview> {
    assertNotAborted(signal)
    assertUniqueInputs(request.inputs)
    onProgress?.(progress(request.taskId, 'previewing', 0.05, '正在检查文件安全性。'))

    const previewFiles: PreviewFile[] = []
    const plannedFiles: PlannedFile[] = []
    for (const [index, selected] of request.inputs.entries()) {
      assertNotAborted(signal)
      await assertInputUnchanged(selected.snapshot, signal)
      const adapter = this.#adapters[selected.snapshot.documentType]

      try {
        const inspection = await adapter.inspect(selected.snapshot, signal)
        const blockers = [...inspection.blockers]
        let previewItems: PreviewFile['items'] = []
        if (blockers.length === 0) {
          const plan = await adapter.createPlan(selected.snapshot, inspection, signal)
          previewItems = plan.previewItems ? [...plan.previewItems] : []
          plannedFiles.push({
            inputId: selected.inputId,
            snapshot: selected.snapshot,
            inspection,
            plan
          })
        }
        previewFiles.push(
          toPreviewFile(selected.inputId, selected.snapshot, inspection, blockers, previewItems)
        )
      } catch (error) {
        if (error instanceof DocumentSafetyError && error.appError.code !== 'TASK_CANCELLED') {
          previewFiles.push({
            inputId: selected.inputId,
            displayName: selected.snapshot.displayName,
            documentType: selected.snapshot.documentType,
            size: selected.snapshot.size,
            fields: [],
            items: [],
            warnings: [],
            blockers: [error.appError]
          })
        } else {
          throw error
        }
      }

      onProgress?.(
        progress(
          request.taskId,
          'previewing',
          0.1 + ((index + 1) / request.inputs.length) * 0.75,
          `已检查 ${index + 1}/${request.inputs.length} 个文件。`
        )
      )
    }

    const createdAt = this.#now()
    const planDigest = digestPlan(request.taskId, plannedFiles, previewFiles)
    const preview = SanitizationPreviewSchema.parse({
      schemaVersion: 1,
      taskId: request.taskId,
      planDigest,
      createdAt: createdAt.toISOString(),
      files: previewFiles
    })
    this.#previews.set(request.taskId, {
      preview,
      plannedFiles,
      expiresAtMs: createdAt.getTime() + this.#previewTtlMs,
      executing: false
    })
    onProgress?.(
      progress(request.taskId, 'awaiting-confirmation', 0.9, '预览已生成，请确认后执行。')
    )
    return preview
  }

  async execute(
    request: {
      taskId: string
      planDigest: string
      outputDirectory: string
      workspaceRootPath?: string
      workspaceRootIdentity?: FileSystemIdentity
      outputDirectoryIdentity?: FileSystemIdentity
      appVersion: string
    },
    signal: AbortSignal,
    onProgress?: ProgressSink
  ): Promise<WorkerExecutionResult> {
    const stored = this.#previews.get(request.taskId)
    if (!stored) throw new DocumentSafetyError('TASK_NOT_FOUND')
    if (stored.executing) throw new DocumentSafetyError('INVALID_REQUEST')
    if (
      this.#now().getTime() > stored.expiresAtMs ||
      stored.preview.planDigest !== request.planDigest
    ) {
      this.#previews.delete(request.taskId)
      throw new DocumentSafetyError('PLAN_EXPIRED')
    }
    if (
      stored.plannedFiles.length !== stored.preview.files.length ||
      stored.preview.files.some((file) => file.blockers.length > 0)
    ) {
      throw new DocumentSafetyError('INVALID_REQUEST')
    }

    stored.executing = true
    const startedAt = this.#now().toISOString()
    const publishedFiles: PublishedFile[] = []
    const hasCallerWorkspace = Boolean(request.workspaceRootPath)
    if (
      hasCallerWorkspace !== Boolean(request.workspaceRootIdentity) ||
      hasCallerWorkspace !== Boolean(request.outputDirectoryIdentity)
    ) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    const workspace = request.workspaceRootPath
      ? await adoptTemporaryWorkspace({
          rootPath: request.workspaceRootPath,
          outputDirectory: request.outputDirectory,
          rootIdentity: request.workspaceRootIdentity as FileSystemIdentity,
          outputDirectoryIdentity: request.outputDirectoryIdentity as FileSystemIdentity
        })
      : await createTemporaryWorkspace(request.outputDirectory)
    const cleanupOwnedByCaller = Boolean(request.workspaceRootPath)
    const outputDirectory = workspace.outputDirectory
    let workspaceCleaned = false

    try {
      assertNotAborted(signal)
      const outputPaths = stored.plannedFiles.map((file) =>
        buildSanitizedOutputPath(file.snapshot.absolutePath, outputDirectory)
      )
      assertUniqueOutputPaths(outputPaths)
      const reportPaths = buildReportPaths(request.taskId, outputDirectory)
      await Promise.all(
        [...outputPaths, reportPaths.json, reportPaths.html].map(assertOutputAvailable)
      )
      await Promise.all(
        stored.plannedFiles.map((file) => assertInputUnchanged(file.snapshot, signal))
      )
      onProgress?.(progress(request.taskId, 'running', 0.12, '安全检查通过，正在生成临时文件。'))

      const temporaryPaths: string[] = []
      for (const [index, file] of stored.plannedFiles.entries()) {
        assertNotAborted(signal)
        const temporaryPath = await reserveTemporaryFile(
          workspace,
          basename(outputPaths[index] as string)
        )
        temporaryPaths.push(temporaryPath)
        await this.#adapters[file.snapshot.documentType].sanitizeToTemp(
          file.snapshot,
          file.plan,
          temporaryPath,
          signal
        )
        onProgress?.(
          progress(
            request.taskId,
            'running',
            0.12 + ((index + 1) / stored.plannedFiles.length) * 0.43,
            `已生成 ${index + 1}/${stored.plannedFiles.length} 个临时文件。`
          )
        )
      }

      onProgress?.(progress(request.taskId, 'verifying', 0.6, '正在验证文档内容未被意外修改。'))
      const verifications: VerificationReport[] = []
      for (const [index, file] of stored.plannedFiles.entries()) {
        const verification = await this.#adapters[file.snapshot.documentType].verify(
          file.snapshot,
          file.plan,
          temporaryPaths[index] as string,
          signal
        )
        verifications.push(verification)
        if (verification.status !== 'passed') throw new DocumentSafetyError('INTERNAL_ERROR')
        onProgress?.(
          progress(
            request.taskId,
            'verifying',
            0.6 + ((index + 1) / stored.plannedFiles.length) * 0.22,
            `已验证 ${index + 1}/${stored.plannedFiles.length} 个文件。`
          )
        )
      }

      const completionVerification = aggregateVerification(verifications)
      const completionProgress = TaskProgressSchema.parse(
        progress(request.taskId, 'completed', 1, '清洗和验证已完成。', completionVerification)
      )

      const report = await buildCompletedReport({
        appVersion: request.appVersion,
        taskId: request.taskId,
        startedAt,
        completedAt: this.#now().toISOString(),
        files: stored.plannedFiles.map((file, index) => ({
          ...file,
          outputPath: outputPaths[index] as string,
          temporaryPath: temporaryPaths[index] as string,
          verification: verifications[index] as VerificationReport
        }))
      })

      assertPublicSanitizationResultFits({
        taskId: request.taskId,
        report,
        outputPaths,
        reportPaths
      })

      for (const [index, file] of stored.plannedFiles.entries()) {
        const outputPath = outputPaths[index] as string
        publishedFiles.push(
          await finalizeVerifiedOutput({
            workspace,
            input: file.snapshot,
            temporaryPath: temporaryPaths[index] as string,
            outputPath,
            verification: verifications[index] as VerificationReport,
            signal
          })
        )
      }

      publishedFiles.push(
        ...(await publishSanitizationReportFiles({ workspace, report, paths: reportPaths }))
      )

      const result = WorkerExecutionResultSchema.parse({
        schemaVersion: 1,
        taskId: request.taskId,
        report,
        completionVerification,
        outputPaths,
        jsonReportPath: reportPaths.json,
        htmlReportPath: reportPaths.html
      })
      if (!cleanupOwnedByCaller) {
        await cleanupTemporaryWorkspace(workspace)
        workspaceCleaned = true
      }
      onProgress?.(completionProgress)
      return result
    } catch (error) {
      let rollbackError: unknown
      try {
        await rollbackPublishedFiles(publishedFiles)
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError
      }
      if (!workspaceCleaned) await cleanupTemporaryWorkspace(workspace).catch(() => undefined)
      if (rollbackError) throw rollbackError
      throw error
    } finally {
      this.#previews.delete(request.taskId)
    }
  }

  cancel(taskId: string): void {
    this.#previews.delete(taskId)
  }
}

function toPreviewFile(
  inputId: string,
  snapshot: InputSnapshot,
  inspection: DocumentInspection,
  blockers: PreviewFile['blockers'],
  items: PreviewFile['items'] = []
): PreviewFile {
  return {
    inputId,
    displayName: snapshot.displayName,
    documentType: snapshot.documentType,
    size: snapshot.size,
    fields: inspection.fields.map((field) => ({ ...field })),
    items,
    warnings: [...inspection.warnings],
    blockers
  }
}

function progress(
  taskId: string,
  state: TaskProgress['state'],
  value: number,
  message: string,
  verification?: VerificationReport
): TaskProgress {
  return {
    schemaVersion: 1,
    taskId,
    state,
    progress: value,
    message,
    ...(verification ? { verification } : {})
  }
}

function digestPlan(
  taskId: string,
  plannedFiles: PlannedFile[],
  previewFiles: PreviewFile[]
): string {
  const digestInput = {
    schemaVersion: 1,
    taskId,
    files: previewFiles.map((previewFile) => {
      const planned = plannedFiles.find((file) => file.inputId === previewFile.inputId)
      return {
        inputId: previewFile.inputId,
        displayName: previewFile.displayName,
        documentType: previewFile.documentType,
        size: previewFile.size,
        sha256: planned?.snapshot.sha256 ?? null,
        mtimeMs: planned?.snapshot.mtimeMs ?? null,
        fields: previewFile.fields,
        items: previewFile.items ?? [],
        blockers: previewFile.blockers.map((blocker) => blocker.code)
      }
    })
  }
  return createHash('sha256').update(JSON.stringify(digestInput)).digest('hex')
}

function assertUniqueInputs(inputs: WorkerPreviewRequest['inputs']): void {
  if (
    new Set(inputs.map((input) => input.inputId)).size !== inputs.length ||
    new Set(inputs.map((input) => normalizeFileIdentity(input.snapshot.absolutePath))).size !==
      inputs.length
  ) {
    throw new DocumentSafetyError('INVALID_REQUEST')
  }
}

function assertUniqueOutputPaths(paths: readonly string[]): void {
  if (new Set(paths.map((filePath) => normalizeFileIdentity(filePath))).size !== paths.length) {
    throw new DocumentSafetyError('OUTPUT_EXISTS')
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
}

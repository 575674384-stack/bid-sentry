import { lstat, open } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type {
  DocumentType,
  InputSnapshot,
  SanitizationReport,
  SanitizationTaskResult,
  VerificationReport
} from '../../shared/contracts'
import { SanitizationTaskResultSchema } from '../../shared/contracts'
import type { DocumentInspection, DocumentSanitizationPlan } from '../documents/documentAdapter'
import {
  publishReservedWorkspaceFile,
  reserveTemporaryFile,
  rollbackPublishedFiles,
  type PublishedFile,
  type TemporaryWorkspace
} from '../documents/fileSafety'
import {
  buildSanitizationReport,
  renderSanitizationReportHtml,
  serializeSanitizationReport
} from './report'

export interface CompletedSanitizationFile {
  snapshot: InputSnapshot
  inspection: DocumentInspection
  plan: DocumentSanitizationPlan
  outputPath: string
  temporaryPath: string
  verification: VerificationReport
}

export async function buildCompletedReport(options: {
  appVersion: string
  taskId: string
  startedAt: string
  completedAt: string
  files: CompletedSanitizationFile[]
}): Promise<SanitizationReport> {
  const files = await Promise.all(
    options.files.map(async (file) => {
      const outputInfo = await lstat(file.temporaryPath)
      return {
        input: toReportIdentity(file.snapshot),
        output: {
          displayName: basename(file.outputPath),
          documentType: file.snapshot.documentType,
          size: outputInfo.size,
          sha256: file.verification.outputSha256
        },
        outputDisplayName: basename(file.outputPath),
        fields: file.plan.fields.map((field) => ({
          field: field.field,
          category: field.category,
          occurrences: field.occurrences,
          status:
            field.action === 'randomize'
              ? ('changed' as const)
              : field.action === 'preserve'
                ? ('preserved' as const)
                : ('warning' as const)
        })),
        warnings: [...file.inspection.warnings],
        verification: file.verification
      }
    })
  )

  return buildSanitizationReport({
    appVersion: options.appVersion,
    taskId: options.taskId,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    status: 'completed',
    files,
    warnings: []
  })
}

export function assertPublicSanitizationResultFits(options: {
  taskId: string
  report: SanitizationReport
  outputPaths: readonly string[]
  reportPaths: { json: string; html: string }
}): SanitizationTaskResult {
  return SanitizationTaskResultSchema.parse({
    schemaVersion: 1,
    taskId: options.taskId,
    report: options.report,
    files: [
      ...options.outputPaths.map((outputPath, index) => ({
        fileId: artifactId(index),
        displayName: basename(outputPath),
        kind: 'sanitized-document' as const
      })),
      {
        fileId: artifactId(options.outputPaths.length),
        displayName: basename(options.reportPaths.json),
        kind: 'json-report' as const
      },
      {
        fileId: artifactId(options.outputPaths.length + 1),
        displayName: basename(options.reportPaths.html),
        kind: 'html-report' as const
      }
    ]
  })
}

function artifactId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

export function buildReportPaths(
  taskId: string,
  outputDirectory: string
): {
  json: string
  html: string
} {
  const base = `bid-sentry-report-${taskId}`
  return {
    json: join(resolve(outputDirectory), `${base}.json`),
    html: join(resolve(outputDirectory), `${base}.html`)
  }
}

export async function publishSanitizationReportFiles(options: {
  workspace: TemporaryWorkspace
  report: SanitizationReport
  paths: { json: string; html: string }
}): Promise<PublishedFile[]> {
  const jsonTemporaryPath = await reserveTemporaryFile(
    options.workspace,
    basename(options.paths.json)
  )
  const htmlTemporaryPath = await reserveTemporaryFile(
    options.workspace,
    basename(options.paths.html)
  )
  await Promise.all([
    writeReservedFile(jsonTemporaryPath, serializeSanitizationReport(options.report)),
    writeReservedFile(htmlTemporaryPath, renderSanitizationReportHtml(options.report))
  ])

  const published: PublishedFile[] = []
  try {
    published.push(
      await publishReservedWorkspaceFile({
        workspace: options.workspace,
        temporaryPath: jsonTemporaryPath,
        outputPath: options.paths.json
      })
    )
    published.push(
      await publishReservedWorkspaceFile({
        workspace: options.workspace,
        temporaryPath: htmlTemporaryPath,
        outputPath: options.paths.html
      })
    )
    return published
  } catch (error) {
    const rollbackError = await rollbackPublishedFiles(published).then(
      () => null,
      (caught: unknown) => caught
    )
    if (rollbackError) throw rollbackError
    throw error
  }
}

async function writeReservedFile(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, 'r+', 0o600)
  try {
    await handle.truncate(0)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function toReportIdentity(snapshot: InputSnapshot): {
  displayName: string
  documentType: DocumentType
  size: number
  sha256: string
} {
  return {
    displayName: snapshot.displayName,
    documentType: snapshot.documentType,
    size: snapshot.size,
    sha256: snapshot.sha256
  }
}

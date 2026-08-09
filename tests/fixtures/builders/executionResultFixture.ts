import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  renderSanitizationReportHtml,
  serializeSanitizationReport
} from '../../../src/core/sanitization/report'
import { aggregateVerification } from '../../../src/core/sanitization/verificationSummary'
import {
  WorkerExecutionResultSchema,
  type SanitizationReport,
  type VerificationReport,
  type WorkerExecutionResult
} from '../../../src/shared/contracts'

export async function writeExecutionResultFixture(options: {
  taskId: string
  inputSha256: string
  inputDisplayName: string
  outputDirectory: string
  workspaceRootPath: string
}): Promise<WorkerExecutionResult> {
  await mkdir(options.workspaceRootPath, { recursive: true })
  const extension = options.inputDisplayName.endsWith('.pdf') ? '.pdf' : '.docx'
  const outputDisplayName = `${options.inputDisplayName.slice(0, -extension.length)}_sanitized${extension}`
  const outputPath = join(options.outputDirectory, outputDisplayName)
  const temporaryOutputPath = temporaryPath(options.workspaceRootPath, outputDisplayName)
  const documentContents = Buffer.from('synthetic verified document', 'utf8')
  await writeFile(temporaryOutputPath, documentContents)
  await link(temporaryOutputPath, outputPath)
  const outputSha256 = createHash('sha256').update(documentContents).digest('hex')
  const verification: VerificationReport = {
    schemaVersion: 1,
    status: 'passed',
    checks: [{ name: 'content', status: 'passed', message: '内容一致。' }],
    inputSha256: options.inputSha256,
    outputSha256
  }
  const report: SanitizationReport = {
    schemaVersion: 1,
    appVersion: '0.1.0',
    taskId: options.taskId,
    startedAt: '2026-08-09T10:00:00+08:00',
    completedAt: '2026-08-09T10:00:01+08:00',
    status: 'completed',
    files: [
      {
        input: {
          displayName: options.inputDisplayName,
          documentType: options.inputDisplayName.endsWith('.pdf') ? 'pdf' : 'docx',
          size: 100,
          sha256: options.inputSha256
        },
        output: {
          displayName: outputDisplayName,
          documentType: options.inputDisplayName.endsWith('.pdf') ? 'pdf' : 'docx',
          size: (await stat(temporaryOutputPath)).size,
          sha256: outputSha256
        },
        outputDisplayName,
        fields: [],
        warnings: [],
        verification
      }
    ],
    warnings: []
  }
  const jsonReportPath = join(options.outputDirectory, `bid-sentry-report-${options.taskId}.json`)
  const htmlReportPath = join(options.outputDirectory, `bid-sentry-report-${options.taskId}.html`)
  await writeLinkedArtifact(
    options.workspaceRootPath,
    jsonReportPath,
    serializeSanitizationReport(report)
  )
  await writeLinkedArtifact(
    options.workspaceRootPath,
    htmlReportPath,
    renderSanitizationReportHtml(report)
  )
  return WorkerExecutionResultSchema.parse({
    schemaVersion: 1,
    taskId: options.taskId,
    report,
    completionVerification: aggregateVerification([verification]),
    outputPaths: [outputPath],
    jsonReportPath,
    htmlReportPath
  })
}

async function writeLinkedArtifact(
  workspaceRootPath: string,
  finalPath: string,
  contents: string
): Promise<void> {
  const workspacePath = temporaryPath(workspaceRootPath, basename(finalPath))
  await writeFile(workspacePath, contents, 'utf8')
  await link(workspacePath, finalPath)
}

function temporaryPath(workspaceRootPath: string, displayName: string): string {
  return join(workspaceRootPath, `${randomUUID()}-${displayName}`)
}

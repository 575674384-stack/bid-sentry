import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentAdapter } from '../../src/core/documents/documentAdapter'
import {
  DocumentSafetyError,
  buildSanitizedOutputPath,
  createInputSnapshot,
  sha256File
} from '../../src/core/documents/fileSafety'
import { SanitizationJob } from '../../src/core/sanitization/sanitizeJob'
import type { WorkerPreviewRequest } from '../../src/shared/contracts'
import { DOCX_FIXTURE_VALUES, writeDocxFixture } from '../fixtures/builders/docxFixture'
import { writePdfFixture } from '../fixtures/builders/pdfFixture'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('SanitizationJob', () => {
  it('previews selected snapshots without writing files or exposing metadata values', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const before = await readdir(directory)

    const preview = await new SanitizationJob().preview(request, new AbortController().signal)

    expect(await readdir(directory)).toEqual(before)
    expect(preview.files[0]).toMatchObject({
      displayName: 'bid.docx',
      documentType: 'docx',
      blockers: []
    })
    expect(preview.files[0]?.fields.length).toBeGreaterThan(0)
    expect(JSON.stringify(preview)).not.toContain(DOCX_FIXTURE_VALUES.person)
  })

  it('rejects execution without a current confirmed preview and invalidates a bad digest', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob()

    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: 'a'.repeat(64),
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'TASK_NOT_FOUND' } })

    await job.preview(request, new AbortController().signal)
    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: 'b'.repeat(64),
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'PLAN_EXPIRED' } })
    await expect(access(buildSanitizedOutputPath(inputPath, directory))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('expires previews and rejects inputs changed after preview', async () => {
    const directory = await createTemporaryDirectory()
    const firstPath = join(directory, 'expired.docx')
    await writeDocxFixture(firstPath)
    const firstRequest = await previewRequest(firstPath)
    let nowMs = Date.parse('2026-08-09T10:00:00+08:00')
    const expiringJob = new SanitizationJob({
      now: () => new Date(nowMs),
      previewTtlMs: 1_000
    })
    const expiredPreview = await expiringJob.preview(firstRequest, new AbortController().signal)
    nowMs += 1_001
    await expect(
      expiringJob.execute(
        {
          taskId: firstRequest.taskId,
          planDigest: expiredPreview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'PLAN_EXPIRED' } })

    const changedPath = join(directory, 'changed.docx')
    await writeDocxFixture(changedPath)
    const changedRequest = await previewRequest(changedPath)
    const changedJob = new SanitizationJob()
    const preview = await changedJob.preview(changedRequest, new AbortController().signal)
    await writeFile(changedPath, Buffer.from('changed after preview'))
    await expect(
      changedJob.execute(
        {
          taskId: changedRequest.taskId,
          planDigest: preview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'FILE_CHANGED' } })
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('does not overwrite an existing output or leave a temporary workspace', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'conflict.pdf')
    await writePdfFixture(inputPath)
    const outputPath = buildSanitizedOutputPath(inputPath, directory)
    await writeFile(outputPath, 'owned by user')
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob()
    const preview = await job.preview(request, new AbortController().signal)

    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: preview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'OUTPUT_EXISTS' } })
    expect(await readFile(outputPath, 'utf8')).toBe('owned by user')
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('publishes a verified batch and consistent JSON/HTML reports without changing inputs', async () => {
    const directory = await createTemporaryDirectory()
    const docxPath = join(directory, 'qualification.docx')
    const pdfPath = join(directory, 'commercial.pdf')
    await writeDocxFixture(docxPath)
    await writePdfFixture(pdfPath)
    const inputBytes = await Promise.all([readFile(docxPath), readFile(pdfPath)])
    const inputMtimes = await Promise.all([stat(docxPath), stat(pdfPath)])
    const request = await previewRequest(docxPath, pdfPath)
    const job = new SanitizationJob()
    const states: string[] = []
    const preview = await job.preview(request, new AbortController().signal)

    const result = await job.execute(
      {
        taskId: request.taskId,
        planDigest: preview.planDigest,
        outputDirectory: directory,
        appVersion: '0.1.0'
      },
      new AbortController().signal,
      (event) => states.push(event.state)
    )

    expect(result.report.status).toBe('completed')
    expect(result.report.files).toHaveLength(2)
    expect(result.report.files.every((file) => file.verification.status === 'passed')).toBe(true)
    expect(result.completionVerification.status).toBe('passed')
    expect(states).toEqual(expect.arrayContaining(['running', 'verifying', 'completed']))
    expect(await Promise.all([readFile(docxPath), readFile(pdfPath)])).toEqual(inputBytes)
    expect((await stat(docxPath)).mtimeMs).toBe(inputMtimes[0]?.mtimeMs)
    expect((await stat(pdfPath)).mtimeMs).toBe(inputMtimes[1]?.mtimeMs)

    const jsonReport = JSON.parse(await readFile(result.jsonReportPath, 'utf8')) as unknown
    const htmlReport = await readFile(result.htmlReportPath, 'utf8')
    expect(jsonReport).toEqual(result.report)
    expect(htmlReport).toContain(result.taskId)
    expect(htmlReport).toContain('qualification_sanitized.docx')
    expect(htmlReport).not.toContain(DOCX_FIXTURE_VALUES.person)
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('does not publish anything when verification fails', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'failure.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob({ adapters: adapterSet(failingAdapter()) })
    const preview = await job.preview(request, new AbortController().signal)

    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: preview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    expect(await outputAndReportNames(directory)).toEqual([])
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('rejects an oversized public result before publishing any final file', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'oversized.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob({ adapters: adapterSet(oversizedResultAdapter()) })
    const preview = await job.preview(request, new AbortController().signal)

    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: preview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(Error)
    expect(await outputAndReportNames(directory)).toEqual([])
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('rejects an oversized completion event before publishing any final file', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'oversized-event.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob({ adapters: adapterSet(oversizedResultAdapter(2_500)) })
    const preview = await job.preview(request, new AbortController().signal)

    await expect(
      job.execute(
        {
          taskId: request.taskId,
          planDigest: preview.planDigest,
          outputDirectory: directory,
          appVersion: '0.1.0'
        },
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(Error)
    expect(await outputAndReportNames(directory)).toEqual([])
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })

  it('aborts execution and removes temporary files on cancellation', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'cancel.docx')
    await writeDocxFixture(inputPath)
    const request = await previewRequest(inputPath)
    const job = new SanitizationJob({ adapters: adapterSet(cancellableAdapter()) })
    const preview = await job.preview(request, new AbortController().signal)
    const controller = new AbortController()
    const execution = job.execute(
      {
        taskId: request.taskId,
        planDigest: preview.planDigest,
        outputDirectory: directory,
        appVersion: '0.1.0'
      },
      controller.signal
    )
    controller.abort()

    await expect(execution).rejects.toMatchObject({ appError: { code: 'TASK_CANCELLED' } })
    expect(await outputAndReportNames(directory)).toEqual([])
    expect(await temporaryWorkspaceNames(directory)).toEqual([])
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-job-'))
  temporaryDirectories.push(directory)
  return directory
}

async function previewRequest(...paths: string[]): Promise<WorkerPreviewRequest> {
  return {
    schemaVersion: 1,
    type: 'preview',
    taskId: randomUUID(),
    inputs: await Promise.all(
      paths.map(async (filePath) => ({
        inputId: randomUUID(),
        snapshot: await createInputSnapshot(filePath)
      }))
    )
  }
}

function failingAdapter(): DocumentAdapter {
  return syntheticAdapter(async (input, _plan, temporaryPath) => {
    await writeFile(temporaryPath, 'sanitized')
    return {
      schemaVersion: 1,
      status: 'failed',
      checks: [{ name: 'content', status: 'failed', message: '内容不一致。' }],
      inputSha256: input.sha256,
      outputSha256: await sha256File(temporaryPath)
    }
  })
}

function cancellableAdapter(): DocumentAdapter {
  return syntheticAdapter(async (_input, _plan, _temporaryPath, signal) => {
    if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DocumentSafetyError('TASK_CANCELLED', signal.reason)),
        { once: true }
      )
    })
    throw new DocumentSafetyError('INTERNAL_ERROR')
  })
}

function oversizedResultAdapter(checkCount = 10_000): DocumentAdapter {
  return syntheticAdapter(async (input, _plan, temporaryPath) => ({
    schemaVersion: 1,
    status: 'passed',
    checks: Array.from({ length: checkCount }, (_, index) => ({
      name: `content-${index}`,
      status: 'passed' as const,
      message: 'x'.repeat(500)
    })),
    inputSha256: input.sha256,
    outputSha256: await sha256File(temporaryPath)
  }))
}

function syntheticAdapter(verify: DocumentAdapter['verify']): DocumentAdapter {
  return {
    documentType: 'docx',
    async inspect() {
      return {
        documentType: 'docx',
        fields: [
          {
            field: 'core:creator',
            category: 'person-identity',
            valueType: 'string',
            occurrences: 1,
            action: 'randomize'
          }
        ],
        warnings: [],
        blockers: []
      }
    },
    async createPlan(input, inspection) {
      return {
        documentType: 'docx',
        inputSha256: input.sha256,
        fields: inspection.fields
      }
    },
    async sanitizeToTemp(_input, _plan, temporaryPath, signal) {
      if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
      await writeFile(temporaryPath, 'sanitized')
    },
    verify
  }
}

function adapterSet(docx: DocumentAdapter): Readonly<Record<'docx' | 'pdf', DocumentAdapter>> {
  return { docx, pdf: docx }
}

async function temporaryWorkspaceNames(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith('.bid-sentry-tmp-'))
}

async function outputAndReportNames(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter(
    (name) => name.includes('_sanitized.') || name.startsWith('bid-sentry-report-')
  )
}

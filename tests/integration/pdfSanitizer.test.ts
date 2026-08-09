import { access, link, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprintPdfStructure } from '../../src/core/documents/pdf/fingerprint'
import { pdfDocumentAdapter } from '../../src/core/documents/pdf/index'
import { loadSafePdfFile } from '../../src/core/documents/pdf/inspect'
import { scanPdfMetadata, type PdfMetadataOccurrence } from '../../src/core/documents/pdf/metadata'
import {
  buildSanitizedOutputPath,
  cleanupTemporaryWorkspace,
  createInputSnapshot,
  createTemporaryWorkspace,
  finalizeVerifiedOutput,
  reserveTemporaryFile
} from '../../src/core/documents/fileSafety'
import {
  PDF_FIXTURE_VALUES,
  writePdfFixture,
  type PdfFixtureOptions
} from '../fixtures/builders/pdfFixture'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('PDF metadata sanitizer', () => {
  it('randomizes Info, XMP and Trailer ID consistently while preserving PDF structure', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.pdf')
    const outputPath = join(directory, 'bid-sanitized.pdf')
    await writePdfFixture(inputPath)
    await reserveOutput(outputPath)
    const originalInputBytes = await readFile(inputPath)
    const originalInputMtime = (await stat(inputPath)).mtimeMs
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal

    const inspection = await pdfDocumentAdapter.inspect(input, signal)
    const serializedInspection = JSON.stringify(inspection)
    for (const value of [
      PDF_FIXTURE_VALUES.author,
      PDF_FIXTURE_VALUES.creator,
      PDF_FIXTURE_VALUES.producer,
      PDF_FIXTURE_VALUES.title,
      PDF_FIXTURE_VALUES.subject,
      PDF_FIXTURE_VALUES.keywords
    ]) {
      expect(serializedInspection).not.toContain(value)
    }
    const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)
    await pdfDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)
    const verification = await pdfDocumentAdapter.verify(input, plan, outputPath, signal)

    expect(verification.status).toBe('passed')
    expect(verification.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'metadata-randomized', status: 'passed' }),
        expect.objectContaining({ name: 'page-content-unchanged', status: 'passed' }),
        expect.objectContaining({ name: 'attachments-unchanged', status: 'passed' })
      ])
    )
    expect(await readFile(inputPath)).toEqual(originalInputBytes)
    expect((await stat(inputPath)).mtimeMs).toBe(originalInputMtime)

    const [{ document: source }, { document: output }] = await Promise.all([
      loadSafePdfFile(inputPath),
      loadSafePdfFile(outputPath)
    ])
    expect(fingerprintPdfStructure(output)).toEqual(fingerprintPdfStructure(source))

    const sourceOccurrences = scanPdfMetadata(source).occurrences
    const outputOccurrences = scanPdfMetadata(output).occurrences
    const sourceTrailerId = occurrence(sourceOccurrences, 'trailer:ID').originalValue
    const outputTrailerId = occurrence(outputOccurrences, 'trailer:ID').originalValue
    expect(outputTrailerId).toMatch(/^[\da-f]{32}:[\da-f]{32}$/u)
    expect(outputTrailerId).not.toBe(sourceTrailerId)

    expect(occurrence(outputOccurrences, 'info:Author').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:creator:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:Creator').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:CreatorTool:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:Producer').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:Producer:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:Title').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:title:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:Subject').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:subject:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:Keywords').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:Keywords:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:CreationDate').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:CreateDate:1').originalValue
    )
    expect(occurrence(outputOccurrences, 'info:ModDate').originalValue).toBe(
      occurrence(outputOccurrences, 'xmp:pdf:xmp:ModifyDate:1').originalValue
    )

    const info = output.context.lookup(output.context.trailerInfo.Info, PDFDict)
    expect(info.lookup(PDFName.of('VendorPrivate'), PDFString).decodeText()).toBe(
      'KEEP-INFO-VENDOR-VALUE'
    )
    expect(
      (await readFile(outputPath)).includes(Buffer.from(PDF_FIXTURE_VALUES.vendorXmpValue))
    ).toBe(true)
  })

  it('sanitizes an image-only scanned PDF without requiring OCR', async () => {
    const directory = await createTemporaryDirectory()
    const result = await sanitizeFixture(directory, 'scanned', { scanned: true })

    expect(result.inspection.blockers).toEqual([])
    expect(result.verification.status).toBe('passed')
    expect(result.verification.checks).toContainEqual(
      expect.objectContaining({ name: 'page-content-unchanged', status: 'passed' })
    )
  })

  it('accepts equivalent single-Flate XMP filters and default decode parameters', async () => {
    const directory = await createTemporaryDirectory()
    const variants: readonly [string, PdfFixtureOptions][] = [
      ['filter-name', { xmpFilterForm: 'name' }],
      ['filter-array', { xmpFilterForm: 'array' }],
      ['filter-short-name', { xmpFilterForm: 'abbreviated' }],
      ['filter-indirect-array', { xmpFilterForm: 'indirect-array-item' }],
      ['decode-null', { xmpDecodeParmsForm: 'null' }],
      ['decode-empty-dictionary', { xmpDecodeParmsForm: 'empty-dictionary' }],
      ['decode-array-null', { xmpFilterForm: 'array', xmpDecodeParmsForm: 'array-null' }],
      [
        'decode-array-empty-dictionary',
        { xmpFilterForm: 'array', xmpDecodeParmsForm: 'array-empty-dictionary' }
      ],
      ['unfiltered-decode-null', { compressedXmp: false, xmpDecodeParmsForm: 'null' }],
      [
        'unfiltered-decode-empty-dictionary',
        { compressedXmp: false, xmpDecodeParmsForm: 'empty-dictionary' }
      ]
    ]

    for (const [name, options] of variants) {
      const result = await sanitizeFixture(directory, name, options)
      expect(result.verification.status).toBe('passed')
    }

    const invalidPath = join(directory, 'non-default-parameters.pdf')
    await writePdfFixture(invalidPath, { xmpDecodeParmsForm: 'non-default' })
    const invalidInput = await createInputSnapshot(invalidPath)
    await expect(
      pdfDocumentAdapter.inspect(invalidInput, new AbortController().signal)
    ).rejects.toMatchObject({ appError: { code: 'INVALID_DOCUMENT' } })

    const invalidUnfilteredPath = join(directory, 'unfiltered-non-default-parameters.pdf')
    await writePdfFixture(invalidUnfilteredPath, {
      compressedXmp: false,
      xmpDecodeParmsForm: 'non-default'
    })
    const invalidUnfilteredInput = await createInputSnapshot(invalidUnfilteredPath)
    await expect(
      pdfDocumentAdapter.inspect(invalidUnfilteredInput, new AbortController().signal)
    ).rejects.toMatchObject({ appError: { code: 'INVALID_DOCUMENT' } })
  })

  it('rejects each structural signature form with a content-free evidence reason', async () => {
    const directory = await createTemporaryDirectory()
    const variants: readonly [string, PdfFixtureOptions, string][] = [
      ['signature-field', { signatureFieldOnly: true }, 'field-type'],
      ['signature-dictionary', { signatureTypeOnly: true }, 'dictionary-type'],
      ['byte-range', { byteRangeOnly: true }, 'byte-range:raw-confirmed']
    ]

    for (const [name, options, reason] of variants) {
      const inputPath = join(directory, `${name}.pdf`)
      await writePdfFixture(inputPath, options)
      const input = await createInputSnapshot(inputPath)
      const error = await captureRejection(
        pdfDocumentAdapter.inspect(input, new AbortController().signal)
      )
      expect(error).toMatchObject({
        appError: { code: 'SIGNED_PDF' },
        cause: {
          name: 'PdfSignatureEvidenceError',
          message: `pdf-signature-evidence:${reason}`
        }
      })
    }

    const combinedPath = join(directory, 'combined-signature.pdf')
    await writePdfFixture(combinedPath, { signed: true })
    const combinedInput = await createInputSnapshot(combinedPath)
    await expect(
      pdfDocumentAdapter.inspect(combinedInput, new AbortController().signal)
    ).rejects.toMatchObject({ appError: { code: 'SIGNED_PDF' } })
  })

  it('does not treat ByteRange-like ordinary PDF data as signature evidence', async () => {
    const directory = await createTemporaryDirectory()
    const result = await sanitizeFixture(directory, 'unsigned-byte-range-text', {
      unsignedByteRangeText: true
    })

    expect(result.verification.status).toBe('passed')
  })

  it('rejects encryption and malformed inputs', async () => {
    const directory = await createTemporaryDirectory()
    const variants: readonly [string, PdfFixtureOptions, string][] = [
      ['encrypted', { encrypted: true }, 'ENCRYPTED_FILE'],
      ['malformed', { malformed: true }, 'INVALID_DOCUMENT'],
      ['malformed-xmp', { malformedXmp: true }, 'INVALID_DOCUMENT']
    ]

    for (const [name, options, errorCode] of variants) {
      const inputPath = join(directory, `${name}.pdf`)
      await writePdfFixture(inputPath, options)
      const input = await createInputSnapshot(inputPath)
      await expect(
        pdfDocumentAdapter.inspect(input, new AbortController().signal)
      ).rejects.toMatchObject({ appError: { code: errorCode } })
    }
  })

  it('fails verification after page drift and cannot publish the temporary PDF', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'tampered.pdf')
    await writePdfFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await pdfDocumentAdapter.inspect(input, signal)
    const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)
    const workspace = await createTemporaryWorkspace(directory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'tampered_sanitized.pdf')
    const outputPath = buildSanitizedOutputPath(inputPath, directory)

    await pdfDocumentAdapter.sanitizeToTemp(input, plan, temporaryPath, signal)
    const tampered = await PDFDocument.load(await readFile(temporaryPath), {
      updateMetadata: false,
      throwOnInvalidObject: true
    })
    tampered.getPage(0).drawText('UNAPPROVED PAGE CHANGE', { x: 40, y: 360 })
    await writeFile(
      temporaryPath,
      await tampered.save({
        useObjectStreams: false,
        addDefaultPage: false,
        updateFieldAppearances: false
      })
    )

    const verification = await pdfDocumentAdapter.verify(input, plan, temporaryPath, signal)
    expect(verification.status).toBe('failed')
    expect(verification.checks).toContainEqual(
      expect.objectContaining({ name: 'page-content-unchanged', status: 'failed' })
    )
    await expect(
      finalizeVerifiedOutput({
        workspace,
        input,
        temporaryPath,
        outputPath,
        verification
      })
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await cleanupTemporaryWorkspace(workspace)
  })

  it('fails verification when Info and XMP timestamps are made inconsistent', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'timestamp-drift.pdf')
    const outputPath = join(directory, 'timestamp-drift-sanitized.pdf')
    await writePdfFixture(inputPath)
    await reserveOutput(outputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await pdfDocumentAdapter.inspect(input, signal)
    const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)
    await pdfDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)

    const tampered = await PDFDocument.load(await readFile(outputPath), {
      updateMetadata: false,
      throwOnInvalidObject: true
    })
    tampered.setCreationDate(new Date('2001-01-01T00:00:00.000Z'))
    await writeFile(
      outputPath,
      await tampered.save({
        useObjectStreams: false,
        addDefaultPage: false,
        updateFieldAppearances: false
      })
    )

    const verification = await pdfDocumentAdapter.verify(input, plan, outputPath, signal)
    expect(verification.status).toBe('failed')
    expect(verification.checks).toContainEqual(
      expect.objectContaining({ name: 'metadata-randomized', status: 'failed' })
    )
  })

  it('honors pre-cancellation and rejects a plan for a different input hash', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.pdf')
    await writePdfFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const cancelled = new AbortController()
    cancelled.abort('test cancellation')

    await expect(pdfDocumentAdapter.inspect(input, cancelled.signal)).rejects.toMatchObject({
      appError: { code: 'TASK_CANCELLED' }
    })

    const signal = new AbortController().signal
    const inspection = await pdfDocumentAdapter.inspect(input, signal)
    const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)
    const unusedOutput = join(directory, 'should-not-exist.pdf')
    await expect(
      pdfDocumentAdapter.sanitizeToTemp(
        input,
        { ...plan, inputSha256: '0'.repeat(64) },
        unusedOutput,
        signal
      )
    ).rejects.toMatchObject({ appError: { code: 'FILE_CHANGED' } })
    await expect(access(unusedOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses the input path and a hard-link alias as temporary output', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.pdf')
    const aliasPath = join(directory, 'input-alias.pdf')
    await writePdfFixture(inputPath)
    const originalBytes = await readFile(inputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await pdfDocumentAdapter.inspect(input, signal)
    const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)

    await expect(
      pdfDocumentAdapter.sanitizeToTemp(input, plan, inputPath, signal)
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    expect(await readFile(inputPath)).toEqual(originalBytes)

    await link(inputPath, aliasPath)
    await expect(
      pdfDocumentAdapter.sanitizeToTemp(input, plan, aliasPath, signal)
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    expect(await readFile(inputPath)).toEqual(originalBytes)
  })
})

async function sanitizeFixture(directory: string, name: string, options: PdfFixtureOptions) {
  const inputPath = join(directory, `${name}.pdf`)
  const outputPath = join(directory, `${name}-sanitized.pdf`)
  await writePdfFixture(inputPath, options)
  await reserveOutput(outputPath)
  const input = await createInputSnapshot(inputPath)
  const signal = new AbortController().signal
  const inspection = await pdfDocumentAdapter.inspect(input, signal)
  const plan = await pdfDocumentAdapter.createPlan(input, inspection, signal)
  await pdfDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)
  const verification = await pdfDocumentAdapter.verify(input, plan, outputPath, signal)
  return { inputPath, outputPath, inspection, plan, verification }
}

async function reserveOutput(filePath: string): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600)
  await handle.close()
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-pdf-'))
  temporaryDirectories.push(directory)
  return directory
}

function occurrence(
  occurrences: readonly PdfMetadataOccurrence[],
  locator: string
): PdfMetadataOccurrence {
  const found = occurrences.find((candidate) => candidate.locator === locator)
  if (!found) throw new Error(`Synthetic PDF occurrence is missing: ${locator}`)
  return found
}

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation
  } catch (error) {
    return error
  }
  throw new Error('Expected operation to reject.')
}

import { access, link, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  archiveEntryMap,
  readDocxArchive,
  replaceArchiveEntries,
  writeDocxArchive,
  type DocxArchive
} from '../../src/core/documents/docx/archive'
import { docxDocumentAdapter } from '../../src/core/documents/docx/index'
import { inspectDocxArchive } from '../../src/core/documents/docx/inspect'
import {
  scanDocxMetadata,
  type DocxMetadataOccurrence
} from '../../src/core/documents/docx/metadata'
import {
  buildSanitizedOutputPath,
  cleanupTemporaryWorkspace,
  createInputSnapshot,
  createTemporaryWorkspace,
  finalizeVerifiedOutput,
  reserveTemporaryFile
} from '../../src/core/documents/fileSafety'
import {
  DOCX_FIXTURE_IMAGE,
  DOCX_FIXTURE_VALUES,
  writeDocxFixture
} from '../fixtures/builders/docxFixture'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('DOCX metadata sanitizer', () => {
  it('randomizes approved metadata consistently while preserving document content', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    const outputPath = join(directory, 'bid-sanitized.docx')
    await writeDocxFixture(inputPath)
    const outputHandle = await open(outputPath, 'wx', 0o600)
    await outputHandle.close()
    const originalInputBytes = await readFile(inputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal

    const inspection = await docxDocumentAdapter.inspect(input, signal)
    expect(inspection.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('外部关系'),
        expect.stringContaining('custom:property:')
      ])
    )
    const serializedInspection = JSON.stringify(inspection)
    expect(serializedInspection).not.toContain(DOCX_FIXTURE_VALUES.person)
    expect(serializedInspection).not.toContain(DOCX_FIXTURE_VALUES.organization)
    expect(serializedInspection).not.toContain(DOCX_FIXTURE_VALUES.hyperlinkBase)
    expect(serializedInspection).not.toContain(DOCX_FIXTURE_VALUES.sensitiveCustomName)
    expect(serializedInspection).not.toContain(DOCX_FIXTURE_VALUES.unsupportedCustomValue)

    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)
    await docxDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)
    const verification = await docxDocumentAdapter.verify(input, plan, outputPath, signal)

    expect(verification.status).toBe('passed')
    expect(verification.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'package-structure', status: 'passed' }),
        expect.objectContaining({ name: 'metadata-randomized', status: 'passed' }),
        expect.objectContaining({ name: 'content-unchanged', status: 'passed' })
      ])
    )
    expect(await readFile(inputPath)).toEqual(originalInputBytes)

    const [sourceArchive, outputArchive] = await Promise.all([
      readDocxArchive(inputPath),
      readDocxArchive(outputPath)
    ])
    const sourceEntries = archiveEntryMap(sourceArchive)
    const outputEntries = archiveEntryMap(outputArchive)
    const sourceScan = scanDocxMetadata(sourceArchive)
    const outputScan = scanDocxMetadata(outputArchive)

    const outputCreator = occurrence(outputScan.occurrences, 'core:creator')
    const outputLastModifier = occurrence(outputScan.occurrences, 'core:lastModifiedBy')
    const outputManager = occurrence(outputScan.occurrences, 'app:Manager')
    const outputCommentAuthor = occurrence(outputScan.occurrences, 'word/comments.xml:w:author')
    const outputRevisionAuthor = occurrence(outputScan.occurrences, 'word/document.xml:w:author')
    expect(outputCreator.originalValue).toMatch(/^User-[A-F0-9]{12}$/u)
    expect(outputLastModifier.originalValue).toBe(outputCreator.originalValue)
    expect(outputManager.originalValue).toBe(outputCreator.originalValue)
    expect(outputCommentAuthor.originalValue).toBe(outputCreator.originalValue)
    expect(outputRevisionAuthor.originalValue).toBe(outputCreator.originalValue)
    expect(occurrence(outputScan.occurrences, 'app:HyperlinkBase').originalValue).not.toBe(
      DOCX_FIXTURE_VALUES.hyperlinkBase
    )

    const outputCommentInitials = occurrence(outputScan.occurrences, 'word/comments.xml:w:initials')
    expect(outputCommentInitials.originalValue).toMatch(/^[A-Z]{4}$/u)

    const created = occurrence(outputScan.occurrences, 'core:created').originalValue
    const modified = occurrence(outputScan.occurrences, 'core:modified').originalValue
    expect(Date.parse(created)).toBeLessThanOrEqual(Date.parse(modified))
    expect(Date.parse(modified)).toBeLessThanOrEqual(Date.now())

    for (const field of ['app:Pages', 'app:Words'] as const) {
      expect(occurrence(outputScan.occurrences, field).originalValue).toBe(
        occurrence(sourceScan.occurrences, field).originalValue
      )
    }
    expect(occurrence(outputScan.occurrences, 'custom:property:8')).toMatchObject({
      action: 'warn',
      originalValue: DOCX_FIXTURE_VALUES.unsupportedCustomValue
    })
    const int8Value = Number(occurrence(outputScan.occurrences, 'custom:property:3').originalValue)
    const uint8Value = Number(occurrence(outputScan.occurrences, 'custom:property:4').originalValue)
    expect(int8Value).toBeGreaterThanOrEqual(-128)
    expect(int8Value).toBeLessThanOrEqual(127)
    expect(uint8Value).toBeGreaterThanOrEqual(0)
    expect(uint8Value).toBeLessThanOrEqual(255)
    expect(
      Number.isFinite(Number(occurrence(outputScan.occurrences, 'custom:property:7').originalValue))
    ).toBe(true)
    expect(occurrence(outputScan.occurrences, 'custom:property:7').originalValue).not.toBe('123.5')

    const outputDocument = requiredEntry(outputEntries, 'word/document.xml').contents.toString(
      'utf8'
    )
    const outputComments = requiredEntry(outputEntries, 'word/comments.xml').contents.toString(
      'utf8'
    )
    expect(outputDocument).toContain(DOCX_FIXTURE_VALUES.bodyText)
    expect(outputDocument).toContain(DOCX_FIXTURE_VALUES.tableText)
    expect(outputComments).toContain(DOCX_FIXTURE_VALUES.commentText)

    for (const partName of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/header1.xml',
      'word/footer1.xml',
      'word/media/image1.png'
    ]) {
      expect(requiredEntry(outputEntries, partName).contents).toEqual(
        requiredEntry(sourceEntries, partName).contents
      )
    }
    expect(requiredEntry(outputEntries, 'word/media/image1.png').contents).toEqual(
      DOCX_FIXTURE_IMAGE
    )
  })

  it('fails verification after unapproved content drift and cannot publish the temp file', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await docxDocumentAdapter.inspect(input, signal)
    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)
    const workspace = await createTemporaryWorkspace(directory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'bid_sanitized.docx')
    const outputPath = buildSanitizedOutputPath(inputPath, directory)

    await docxDocumentAdapter.sanitizeToTemp(input, plan, temporaryPath, signal)
    const sanitizedArchive = await readDocxArchive(temporaryPath)
    const document = archiveEntryMap(sanitizedArchive).get('word/document.xml')
    if (!document) throw new Error('Synthetic DOCX document part is missing.')
    const tamperedDocument = Buffer.from(
      document.contents
        .toString('utf8')
        .replace(DOCX_FIXTURE_VALUES.bodyText, '正文已被故意篡改。'),
      'utf8'
    )
    await writeDocxArchive(
      replaceArchiveEntries(sanitizedArchive, new Map([['word/document.xml', tamperedDocument]])),
      temporaryPath
    )

    const verification = await docxDocumentAdapter.verify(input, plan, temporaryPath, signal)
    expect(verification.status).toBe('failed')
    expect(verification.checks).toContainEqual(
      expect.objectContaining({ name: 'content-unchanged', status: 'failed' })
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

  it('preserves custom values outside the DOC Props VTypes namespace', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'foreign-custom-value.docx')
    const outputPath = join(directory, 'foreign-custom-value-sanitized.docx')
    await writeDocxFixture(inputPath, { foreignCustomValueNamespace: true })
    const outputHandle = await open(outputPath, 'wx', 0o600)
    await outputHandle.close()
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal

    const inspection = await docxDocumentAdapter.inspect(input, signal)
    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)
    await docxDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)
    const verification = await docxDocumentAdapter.verify(input, plan, outputPath, signal)
    const outputScan = scanDocxMetadata(await readDocxArchive(outputPath))

    expect(occurrence(outputScan.occurrences, 'custom:property:9')).toMatchObject({
      action: 'warn',
      originalValue: '12'
    })
    expect(verification.status).toBe('passed')
  })

  it('fails verification when two source identities are tampered to share one alias', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'distinct-identities.docx')
    const outputPath = join(directory, 'distinct-identities-sanitized.docx')
    await writeDocxFixture(inputPath, { distinctManager: true, emptyCreator: true })
    const outputHandle = await open(outputPath, 'wx', 0o600)
    await outputHandle.close()
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await docxDocumentAdapter.inspect(input, signal)
    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)
    await docxDocumentAdapter.sanitizeToTemp(input, plan, outputPath, signal)

    const sanitizedArchive = await readDocxArchive(outputPath)
    const outputScan = scanDocxMetadata(sanitizedArchive)
    const creatorAlias = occurrence(outputScan.occurrences, 'core:creator').originalValue
    const managerAlias = occurrence(outputScan.occurrences, 'app:Manager').originalValue
    expect(managerAlias).not.toBe(creatorAlias)
    const appPart = requiredEntry(archiveEntryMap(sanitizedArchive), 'docProps/app.xml')
    const tamperedApp = Buffer.from(
      appPart.contents.toString('utf8').replace(managerAlias, creatorAlias),
      'utf8'
    )
    await writeDocxArchive(
      replaceArchiveEntries(sanitizedArchive, new Map([['docProps/app.xml', tamperedApp]])),
      outputPath
    )

    const verification = await docxDocumentAdapter.verify(input, plan, outputPath, signal)
    expect(verification.status).toBe('failed')
    expect(verification.checks).toContainEqual(
      expect.objectContaining({ name: 'metadata-randomized', status: 'failed' })
    )
  })

  it('rejects unsafe ZIP structures, DOCM, ordinary ZIP and malformed relationships', async () => {
    const directory = await createTemporaryDirectory()
    const variants = {
      duplicate: { duplicateEntry: true },
      traversal: { traversalEntry: true },
      backslash: { backslashEntry: true },
      bomb: { compressionBomb: true },
      encrypted: { encryptedEntry: true },
      symbolic: { symbolicLinkEntry: true }
    } as const

    for (const [name, options] of Object.entries(variants)) {
      const filePath = join(directory, `${name}.docx`)
      await writeDocxFixture(filePath, options)
      await expect(readDocxArchive(filePath)).rejects.toMatchObject({
        appError: { code: 'UNSAFE_ARCHIVE' }
      })
    }

    const docmPath = join(directory, 'macro.docx')
    await writeDocxFixture(docmPath, { macroEnabled: true })
    const macroArchive = await readDocxArchive(docmPath)
    expect(() => inspectDocxArchive(macroArchive)).toThrowError(
      expect.objectContaining({ appError: expect.objectContaining({ code: 'UNSUPPORTED_TYPE' }) })
    )

    const signedPath = join(directory, 'signed.docx')
    await writeDocxFixture(signedPath, { signedDocument: true })
    const signedArchive = await readDocxArchive(signedPath)
    expect(() => inspectDocxArchive(signedArchive)).toThrowError(
      expect.objectContaining({
        appError: expect.objectContaining({ code: 'SIGNED_DOCUMENT' })
      })
    )

    const plainPath = join(directory, 'plain.docx')
    await writeDocxFixture(plainPath, { plainZip: true })
    const plainArchive = await readDocxArchive(plainPath)
    expect(() => inspectDocxArchive(plainArchive)).toThrowError(
      expect.objectContaining({ appError: expect.objectContaining({ code: 'INVALID_DOCUMENT' }) })
    )

    const brokenPath = join(directory, 'broken-relationships.docx')
    await writeDocxFixture(brokenPath, { brokenDocumentRelationships: true })
    const brokenArchive = await readDocxArchive(brokenPath)
    expect(() => inspectDocxArchive(brokenArchive)).toThrowError(
      expect.objectContaining({ appError: expect.objectContaining({ code: 'INVALID_DOCUMENT' }) })
    )

    const malformedMetadataPath = join(directory, 'malformed-metadata.docx')
    await writeDocxFixture(malformedMetadataPath, { malformedMetadataXml: true })
    const malformedMetadataArchive = await readDocxArchive(malformedMetadataPath)
    expect(() => inspectDocxArchive(malformedMetadataArchive)).toThrowError(
      expect.objectContaining({ appError: expect.objectContaining({ code: 'INVALID_DOCUMENT' }) })
    )

    for (const [name, options] of Object.entries({
      externalMain: { externalMainRelationship: true },
      missingTarget: { missingRelationshipTarget: true },
      escapingTarget: { escapingRelationshipTarget: true },
      encodedEscapingTarget: { encodedEscapingRelationshipTarget: true },
      doubleEncodedTarget: { doubleEncodedRelationshipTarget: true },
      orphanRelationships: { orphanRelationshipPart: true }
    })) {
      const filePath = join(directory, `${name}.docx`)
      await writeDocxFixture(filePath, options)
      const archive = await readDocxArchive(filePath)
      expect(() => inspectDocxArchive(archive)).toThrowError(
        expect.objectContaining({
          appError: expect.objectContaining({ code: 'INVALID_DOCUMENT' })
        })
      )
    }
  })

  it('honors cancellation and rejects a plan for a different input hash', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    await writeDocxFixture(inputPath)
    const input = await createInputSnapshot(inputPath)
    const cancelled = new AbortController()

    const pendingInspection = docxDocumentAdapter.inspect(input, cancelled.signal)
    queueMicrotask(() => cancelled.abort('test cancellation'))
    await expect(pendingInspection).rejects.toMatchObject({
      appError: { code: 'TASK_CANCELLED' }
    })

    const signal = new AbortController().signal
    const inspection = await docxDocumentAdapter.inspect(input, signal)
    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)
    await expect(
      docxDocumentAdapter.sanitizeToTemp(
        input,
        { ...plan, inputSha256: '0'.repeat(64) },
        join(directory, 'should-not-exist.docx'),
        signal
      )
    ).rejects.toMatchObject({ appError: { code: 'FILE_CHANGED' } })
    await expect(access(join(directory, 'should-not-exist.docx'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('refuses the input path and a hard-link alias as temporary output', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    const aliasPath = join(directory, 'input-alias.docx')
    await writeDocxFixture(inputPath)
    const originalBytes = await readFile(inputPath)
    const input = await createInputSnapshot(inputPath)
    const signal = new AbortController().signal
    const inspection = await docxDocumentAdapter.inspect(input, signal)
    const plan = await docxDocumentAdapter.createPlan(input, inspection, signal)

    await expect(
      docxDocumentAdapter.sanitizeToTemp(input, plan, inputPath, signal)
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    expect(await readFile(inputPath)).toEqual(originalBytes)

    await link(inputPath, aliasPath)
    await expect(
      docxDocumentAdapter.sanitizeToTemp(input, plan, aliasPath, signal)
    ).rejects.toMatchObject({ appError: { code: 'INTERNAL_ERROR' } })
    expect(await readFile(inputPath)).toEqual(originalBytes)
  })

  it('aborts archive output in flight and cleans the partial temporary file', async () => {
    const directory = await createTemporaryDirectory()
    const inputPath = join(directory, 'bid.docx')
    await writeDocxFixture(inputPath)
    const sourceArchive = await readDocxArchive(inputPath)
    const largeArchive: DocxArchive = {
      entries: [
        ...sourceArchive.entries,
        {
          name: 'word/large-stored-entry.bin',
          contents: Buffer.alloc(8 * 1024 * 1024, 0x5a),
          compressionMethod: 0,
          lastModified: new Date('2024-01-01T00:00:00.000Z'),
          mode: 0o600,
          isDirectory: false
        }
      ]
    }
    const workspace = await createTemporaryWorkspace(directory)
    const temporaryPath = await reserveTemporaryFile(workspace, 'cancelled.docx')
    const cancelled = new AbortController()

    const pendingWrite = writeDocxArchive(largeArchive, temporaryPath, cancelled.signal)
    queueMicrotask(() => cancelled.abort('write cancellation'))
    await expect(pendingWrite).rejects.toMatchObject({
      appError: { code: 'TASK_CANCELLED' }
    })

    await cleanupTemporaryWorkspace(workspace)
    await expect(access(workspace.rootPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-docx-'))
  temporaryDirectories.push(directory)
  return directory
}

function occurrence(
  occurrences: readonly DocxMetadataOccurrence[],
  field: string
): DocxMetadataOccurrence {
  const found = occurrences.find((candidate) => candidate.field === field)
  if (!found) throw new Error(`Synthetic DOCX occurrence is missing: ${field}`)
  return found
}

function requiredEntry(
  entries: ReadonlyMap<string, { contents: Buffer }>,
  partName: string
): { contents: Buffer } {
  const entry = entries.get(partName)
  if (!entry) throw new Error(`Synthetic DOCX part is missing: ${partName}`)
  return entry
}

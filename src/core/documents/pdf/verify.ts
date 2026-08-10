import type { VerificationCheck, VerificationReport } from '../../../shared/contracts'
import { DocumentSafetyError, sha256File } from '../fileSafety'
import { fingerprintPdfStructure, type PdfStructuralFingerprint } from './fingerprint'
import { loadSafePdfFile } from './inspect'
import {
  pdfMetadataPreservationFingerprint,
  scanPdfMetadata,
  type PdfMetadataOccurrence,
  type PdfMetadataPreservationFingerprint
} from './metadata'

interface SourceVerificationSnapshot {
  occurrences: PdfMetadataOccurrence[]
  metadataPreservation: PdfMetadataPreservationFingerprint
  structure: PdfStructuralFingerprint
}

export async function verifySanitizedPdf(
  inputPath: string,
  inputSha256: string,
  outputPath: string,
  signal?: AbortSignal,
  expectedReplacements?: Readonly<Record<string, string>>
): Promise<VerificationReport> {
  const outputSha256 = await sha256File(outputPath, signal).catch((error: unknown) => {
    rethrowCancellation(error)
    return '0'.repeat(64)
  })
  const checks: VerificationCheck[] = []

  try {
    const source = await buildSourceVerificationSnapshot(inputPath, signal)
    const { document: output } = await loadSafePdfFile(outputPath, signal)
    const outputOccurrences = scanPdfMetadata(output).occurrences
    const outputPreservation = pdfMetadataPreservationFingerprint(output)
    const outputStructure = fingerprintPdfStructure(output)
    checks.push(metadataCheck(source, outputOccurrences, outputPreservation, expectedReplacements))
    checks.push(structureCheck(source.structure, outputStructure))
    checks.push(attachmentCheck(source.structure, outputStructure))
  } catch (error) {
    rethrowCancellation(error)
    checks.push({
      name: 'pdf-structure',
      status: 'failed',
      message: '输出 PDF 无法通过安全结构验证。'
    })
  }

  const status = checks.every((check) => check.status === 'passed') ? 'passed' : 'failed'
  return {
    schemaVersion: 1,
    status,
    checks,
    inputSha256,
    outputSha256
  }
}

async function buildSourceVerificationSnapshot(
  inputPath: string,
  signal?: AbortSignal
): Promise<SourceVerificationSnapshot> {
  const { document } = await loadSafePdfFile(inputPath, signal)
  return {
    occurrences: scanPdfMetadata(document).occurrences,
    metadataPreservation: pdfMetadataPreservationFingerprint(document),
    structure: fingerprintPdfStructure(document)
  }
}

function metadataCheck(
  source: SourceVerificationSnapshot,
  outputOccurrences: readonly PdfMetadataOccurrence[],
  outputPreservation: PdfMetadataPreservationFingerprint,
  expectedReplacements?: Readonly<Record<string, string>>
): VerificationCheck {
  const outputByLocator = new Map(
    outputOccurrences.map((occurrence) => [occurrence.locator, occurrence])
  )
  const mappings = new Map<string, string>()
  const reverseIdentityMappings = new Map<string, string>()
  let passed = source.occurrences.length === outputOccurrences.length

  for (const sourceOccurrence of source.occurrences) {
    const outputOccurrence = outputByLocator.get(sourceOccurrence.locator)
    if (!outputOccurrence || outputOccurrence.action !== sourceOccurrence.action) {
      passed = false
      continue
    }
    if (sourceOccurrence.action !== 'randomize') {
      // Preserved and warned occurrences must reach the output value-identical.
      if (outputOccurrence.originalValue !== sourceOccurrence.originalValue) passed = false
      continue
    }
    if (
      !isValidRandomizedValue(outputOccurrence) ||
      outputOccurrence.originalValue === sourceOccurrence.originalValue
    ) {
      passed = false
    }
    if (expectedReplacements) {
      const expected = expectedReplacements[sourceOccurrence.locator]
      if (expected === undefined || outputOccurrence.originalValue !== expected) passed = false
    }
    const kind = sourceOccurrence.replacementKind
    if (kind && !['timestamp', 'trailer-id'].includes(kind)) {
      const mappingKey = `${kind}|${sourceOccurrence.originalValue}`
      const existing = mappings.get(mappingKey)
      if (existing && existing !== outputOccurrence.originalValue) passed = false
      mappings.set(mappingKey, outputOccurrence.originalValue)
    }
    if (kind === 'person') {
      const aliasKey = `${kind}|${outputOccurrence.originalValue}`
      const aliasedOriginal = reverseIdentityMappings.get(aliasKey)
      if (
        reverseIdentityMappings.has(aliasKey) &&
        aliasedOriginal !== sourceOccurrence.originalValue
      ) {
        passed = false
      }
      reverseIdentityMappings.set(aliasKey, sourceOccurrence.originalValue)
    }
  }

  const created = outputOccurrences.filter(
    (occurrence) => occurrence.action === 'randomize' && occurrence.dateRole === 'created'
  )
  const modified = outputOccurrences.filter(
    (occurrence) => occurrence.action === 'randomize' && occurrence.dateRole === 'modified'
  )
  if (
    new Set(created.map((occurrence) => occurrence.originalValue)).size > 1 ||
    new Set(modified.map((occurrence) => occurrence.originalValue)).size > 1
  ) {
    passed = false
  }
  if (
    created.some((createdOccurrence) =>
      modified.some(
        (modifiedOccurrence) =>
          Date.parse(createdOccurrence.originalValue) > Date.parse(modifiedOccurrence.originalValue)
      )
    )
  ) {
    passed = false
  }
  if (
    source.metadataPreservation.infoSha256 !== outputPreservation.infoSha256 ||
    source.metadataPreservation.xmpSha256 !== outputPreservation.xmpSha256
  ) {
    passed = false
  }

  return {
    name: 'metadata-randomized',
    status: passed ? 'passed' : 'failed',
    message: passed
      ? 'PDF Info、XMP 与 Trailer ID 已安全随机化，未批准元数据保持一致。'
      : 'PDF 元数据随机化或保留字段未满足验证要求。'
  }
}

function structureCheck(
  source: PdfStructuralFingerprint,
  output: PdfStructuralFingerprint
): VerificationCheck {
  const passed =
    source.pageCount === output.pageCount &&
    source.catalogSha256 === output.catalogSha256 &&
    source.pagesSha256 === output.pagesSha256
  return {
    name: 'page-content-unchanged',
    status: passed ? 'passed' : 'failed',
    message: passed
      ? '页面、内容流、资源和注释语义指纹一致。'
      : '检测到未批准的 PDF 页面或对象变化。'
  }
}

function attachmentCheck(
  source: PdfStructuralFingerprint,
  output: PdfStructuralFingerprint
): VerificationCheck {
  const passed = source.namesSha256 === output.namesSha256
  return {
    name: 'attachments-unchanged',
    status: passed ? 'passed' : 'failed',
    message: passed ? 'Names、附件名称和附件内容保持一致。' : 'PDF 附件或 Names 结构发生变化。'
  }
}

function isValidRandomizedValue(occurrence: PdfMetadataOccurrence): boolean {
  const value = occurrence.originalValue.trim()
  if (!value) return false
  if (occurrence.replacementKind === 'trailer-id') {
    return /^[\da-f]{32}:[\da-f]{32}$/u.test(value)
  }
  if (occurrence.valueType === 'timestamp') {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp <= Date.now()
  }
  if (occurrence.valueType === 'uuid') {
    return /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(value)
  }
  if (occurrence.replacementKind === 'trapped') {
    return ['True', 'False', 'Unknown'].includes(value)
  }
  return true
}

function rethrowCancellation(error: unknown): void {
  if (error instanceof DocumentSafetyError && error.appError.code === 'TASK_CANCELLED') {
    throw error
  }
}

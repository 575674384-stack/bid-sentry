import { createHash } from 'node:crypto'
import type { VerificationCheck, VerificationReport } from '../../../shared/contracts'
import { DocumentSafetyError, sha256File } from '../fileSafety'
import { archiveEntryMap, readDocxArchive, type DocxArchive } from './archive'
import { inspectDocxArchive } from './inspect'
import {
  normalizeDocxMetadataPart,
  scanDocxMetadata,
  targetMetadataParts,
  type DocxMetadataOccurrence
} from './metadata'

interface SourceVerificationSnapshot {
  entryNames: string[]
  occurrences: DocxMetadataOccurrence[]
  normalizedParts: ReadonlySet<string>
  contentFingerprints: ReadonlyMap<string, string>
}

export async function verifySanitizedDocx(
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
    const output = await readDocxArchive(outputPath, signal)
    inspectDocxArchive(output)
    checks.push(packageStructureCheck(source, output))
    checks.push(metadataCheck(source, output, expectedReplacements))
    checks.push(contentCheck(source, output))
  } catch (error) {
    rethrowCancellation(error)
    checks.push({
      name: 'docx-structure',
      status: 'failed',
      message: '输出 DOCX 无法通过安全结构验证。'
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
  const source = await readDocxArchive(inputPath, signal)
  inspectDocxArchive(source)
  const normalizedParts = targetMetadataParts(source)
  return {
    entryNames: source.entries.map((entry) => entry.name),
    occurrences: scanDocxMetadata(source).occurrences,
    normalizedParts,
    contentFingerprints: new Map(
      source.entries.map((entry) => [
        entry.name,
        partFingerprint(entry.name, entry.contents, normalizedParts.has(entry.name))
      ])
    )
  }
}

function rethrowCancellation(error: unknown): void {
  if (error instanceof DocumentSafetyError && error.appError.code === 'TASK_CANCELLED') {
    throw error
  }
}

function packageStructureCheck(
  source: SourceVerificationSnapshot,
  output: DocxArchive
): VerificationCheck {
  const outputNames = output.entries.map((entry) => entry.name)
  const passed =
    source.entryNames.length === outputNames.length &&
    source.entryNames.every((name, index) => outputNames[index] === name)

  return {
    name: 'package-structure',
    status: passed ? 'passed' : 'failed',
    message: passed ? 'ZIP 部件名称和顺序一致。' : 'ZIP 部件名称或顺序发生变化。'
  }
}

function metadataCheck(
  source: SourceVerificationSnapshot,
  output: DocxArchive,
  expectedReplacements?: Readonly<Record<string, string>>
): VerificationCheck {
  const sourceOccurrences = source.occurrences
  const outputOccurrences = scanDocxMetadata(output).occurrences
  const outputByKey = new Map(
    outputOccurrences.map((occurrence) => [keyFor(occurrence), occurrence])
  )
  const identityMappings = new Map<string, string>()
  const identityAliases = new Map<string, string>()
  let passed = sourceOccurrences.length === outputOccurrences.length

  for (const sourceOccurrence of sourceOccurrences) {
    const outputOccurrence = outputByKey.get(keyFor(sourceOccurrence))
    if (!outputOccurrence || outputOccurrence.action !== sourceOccurrence.action) {
      passed = false
      continue
    }

    if (sourceOccurrence.action === 'randomize') {
      if (
        !isValidRandomizedValue(outputOccurrence) ||
        outputOccurrence.originalValue === sourceOccurrence.originalValue
      ) {
        passed = false
      }
      if (expectedReplacements) {
        const expected = expectedReplacements[keyFor(sourceOccurrence)]
        if (expected === undefined || outputOccurrence.originalValue !== expected) passed = false
      }
      if (['person', 'initials', 'organization'].includes(sourceOccurrence.replacementKind ?? '')) {
        const mappingKey = `${sourceOccurrence.replacementKind}|${sourceOccurrence.originalValue}`
        const aliasKey = `${sourceOccurrence.replacementKind}|${outputOccurrence.originalValue}`
        const existing = identityMappings.get(mappingKey)
        const aliasedOriginal = identityAliases.get(aliasKey)
        if (existing && existing !== outputOccurrence.originalValue) passed = false
        if (identityAliases.has(aliasKey) && aliasedOriginal !== sourceOccurrence.originalValue) {
          passed = false
        }
        identityMappings.set(mappingKey, outputOccurrence.originalValue)
        identityAliases.set(aliasKey, sourceOccurrence.originalValue)
      }
    } else if (outputOccurrence.originalValue !== sourceOccurrence.originalValue) {
      passed = false
    }
  }

  const created = outputOccurrences.find((occurrence) => occurrence.field === 'core:created')
  const modified = outputOccurrences.find((occurrence) => occurrence.field === 'core:modified')
  if (
    created &&
    modified &&
    Date.parse(created.originalValue) > Date.parse(modified.originalValue)
  ) {
    passed = false
  }

  return {
    name: 'metadata-randomized',
    status: passed ? 'passed' : 'failed',
    message: passed
      ? '目标元数据已变更为合法非空值，保留字段未变化。'
      : '目标元数据或保留字段未满足验证要求。'
  }
}

function contentCheck(source: SourceVerificationSnapshot, output: DocxArchive): VerificationCheck {
  const outputEntries = archiveEntryMap(output)
  let passed = source.entryNames.length === output.entries.length

  for (const partName of source.entryNames) {
    const outputEntry = outputEntries.get(partName)
    if (!outputEntry) {
      passed = false
      continue
    }
    const expectedFingerprint = source.contentFingerprints.get(partName)
    const outputFingerprint = partFingerprint(
      partName,
      outputEntry.contents,
      source.normalizedParts.has(partName)
    )
    if (!expectedFingerprint || expectedFingerprint !== outputFingerprint) {
      passed = false
    }
  }

  return {
    name: 'content-unchanged',
    status: passed ? 'passed' : 'failed',
    message: passed
      ? '除批准的元数据与身份属性外，其余 OOXML 部件保持一致。'
      : '检测到未批准的 OOXML 内容变化。'
  }
}

function partFingerprint(partName: string, contents: Buffer, normalize: boolean): string {
  const hash = createHash('sha256')
  return hash
    .update(normalize ? normalizeDocxMetadataPart(partName, contents) : contents)
    .digest('hex')
}

function keyFor(occurrence: DocxMetadataOccurrence): string {
  return `${occurrence.partName}|${occurrence.locator}`
}

function isValidRandomizedValue(occurrence: DocxMetadataOccurrence): boolean {
  const value = occurrence.originalValue.trim()
  if (!value) return false
  if (occurrence.valueType === 'integer') return /^-?\d+$/u.test(value)
  if (occurrence.valueType === 'number') return Number.isFinite(Number(value))
  if (occurrence.valueType === 'boolean') return /^(true|false)$/u.test(value)
  if (occurrence.valueType === 'timestamp') {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp <= Date.now()
  }
  if (occurrence.valueType === 'uuid') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  }
  return true
}

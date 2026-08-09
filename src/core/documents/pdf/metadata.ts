import { createHash, randomBytes } from 'node:crypto'
import { XMLSerializer } from '@xmldom/xmldom'
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib'
import type { PDFDocument, PDFObject } from 'pdf-lib'
import type {
  MetadataFieldCategory,
  MetadataFieldDescriptor,
  MetadataValueType
} from '../../../shared/contracts'
import type { TaskRandomMapping } from '../../sanitization/randomMapping'
import { DocumentSafetyError } from '../fileSafety'
import type {
  MutablePdfMetadataOccurrence,
  ParsedPdfXmp,
  PdfDateRole,
  PdfMetadataOccurrence,
  PdfMetadataSpec,
  PdfReplacementKind
} from './metadataTypes'
import { parsePdfXmp, writePdfXmp } from './xmp'

export type { PdfMetadataOccurrence } from './metadataTypes'

export interface PdfMetadataScan {
  fields: MetadataFieldDescriptor[]
  warnings: string[]
  occurrences: PdfMetadataOccurrence[]
}

export interface PdfMetadataPreservationFingerprint {
  infoSha256: string
  xmpSha256: string | null
}

interface ParsedMetadata {
  occurrences: MutablePdfMetadataOccurrence[]
  warnings: string[]
  xmp: ParsedPdfXmp | null
}

const INFO_SPECS: readonly PdfMetadataSpec[] = [
  infoSpec('Author', 'pdf:info:Author', 'person-identity', 'string', 'person'),
  infoSpec('Creator', 'pdf:info:Creator', 'application', 'string', 'application'),
  infoSpec('Producer', 'pdf:info:Producer', 'application', 'string', 'application'),
  infoSpec('Title', 'pdf:info:Title', 'description', 'string', 'description'),
  infoSpec('Subject', 'pdf:info:Subject', 'description', 'string', 'description'),
  infoSpec('Keywords', 'pdf:info:Keywords', 'description', 'string', 'description'),
  infoSpec(
    'CreationDate',
    'pdf:info:CreationDate',
    'timestamp',
    'timestamp',
    'timestamp',
    'created'
  ),
  infoSpec('ModDate', 'pdf:info:ModDate', 'timestamp', 'timestamp', 'timestamp', 'modified'),
  infoSpec('Trapped', 'pdf:info:Trapped', 'other', 'string', 'trapped')
]

export function scanPdfMetadata(document: PDFDocument): PdfMetadataScan {
  const parsed = parseMetadata(document)
  const occurrences = parsed.occurrences.map(stripSetter)
  return {
    fields: groupDescriptors(occurrences),
    warnings: parsed.warnings,
    occurrences
  }
}

export function sanitizePdfMetadata(document: PDFDocument, mapping: TaskRandomMapping): void {
  const parsed = parseMetadata(document)
  const handled = new Set<string>()
  const created = parsed.occurrences.filter(
    (occurrence) => occurrence.action === 'randomize' && occurrence.dateRole === 'created'
  )
  const modified = parsed.occurrences.filter(
    (occurrence) => occurrence.action === 'randomize' && occurrence.dateRole === 'modified'
  )
  if (created.length > 0 || modified.length > 0) {
    const pair = mapping.timestampPair(
      created[0]?.originalValue ?? '__missing-created__',
      modified[0]?.originalValue ?? '__missing-modified__'
    )
    const createdValue = pdfCompatibleTimestamp(pair.created)
    const modifiedValue = pdfCompatibleTimestamp(pair.modified)
    for (const occurrence of created) {
      occurrence.setValue(createdValue)
      handled.add(occurrence.locator)
    }
    for (const occurrence of modified) {
      occurrence.setValue(modifiedValue)
      handled.add(occurrence.locator)
    }
  }

  for (const occurrence of parsed.occurrences) {
    if (occurrence.action !== 'randomize' || handled.has(occurrence.locator)) continue
    occurrence.setValue(randomizedValue(mapping, occurrence))
  }
  if (parsed.xmp) writePdfXmp(document, parsed.xmp)
}

export function pdfMetadataPreservationFingerprint(
  document: PDFDocument
): PdfMetadataPreservationFingerprint {
  const info = document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict)
  const parsed = parseMetadata(document)
  const randomizedInfoFields = new Set(
    parsed.occurrences
      .filter(
        (occurrence) => occurrence.locator.startsWith('info:') && occurrence.action === 'randomize'
      )
      .map((occurrence) => occurrence.locator.slice('info:'.length))
  )
  const infoParts = (info?.entries() ?? [])
    .map(([key, value]) => {
      const name = key.decodeText()
      if (randomizedInfoFields.has(name)) return `${key.asString()}=@approved`
      const resolved = value instanceof PDFRef ? document.context.lookup(value) : value
      return `${key.asString()}=${resolved?.toString() ?? '@missing'}`
    })
    .sort()
  const xmp = parsed.xmp
  if (xmp) {
    for (const occurrence of xmp.occurrences) {
      if (occurrence.action === 'randomize' && occurrence.replacementKind) {
        occurrence.setValue(normalizedSentinel(occurrence.replacementKind))
      }
    }
  }
  return {
    infoSha256: sha256(infoParts.join('\n')),
    xmpSha256: xmp ? sha256(new XMLSerializer().serializeToString(xmp.xml)) : null
  }
}

function parseMetadata(document: PDFDocument): ParsedMetadata {
  const info = parseInfo(document)
  const xmp = parsePdfXmp(document)
  const trailer = parseTrailerId(document)
  return {
    occurrences: [...info.occurrences, ...(xmp?.occurrences ?? []), trailer],
    warnings: [...info.warnings, ...(xmp?.warnings ?? [])],
    xmp
  }
}

function parseInfo(document: PDFDocument): {
  occurrences: MutablePdfMetadataOccurrence[]
  warnings: string[]
} {
  const info = document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict)
  const occurrences: MutablePdfMetadataOccurrence[] = []
  const warnings: string[] = []
  if (!info) return { occurrences, warnings }

  for (const spec of INFO_SPECS) {
    const key = PDFName.of(spec.localName)
    const raw = info.get(key)
    if (!raw) continue
    const value = raw instanceof PDFRef ? document.context.lookup(raw) : raw
    const decoded = decodeInfoValue(value, spec)
    const valid = decoded !== null && isValidValue(decoded, spec)
    if (!valid) warnings.push(`${spec.field} 的值类型无效，已保留原值。`)
    occurrences.push({
      locator: `info:${spec.localName}`,
      field: spec.field,
      category: spec.category,
      valueType: spec.valueType,
      action: valid ? 'randomize' : 'warn',
      replacementKind: valid ? spec.replacementKind : null,
      originalValue: decoded ?? value?.toString() ?? '',
      dateRole: spec.dateRole ?? null,
      setValue: (replacement) => setInfoValue(info, key, replacement, spec)
    })
  }
  return { occurrences, warnings }
}

function parseTrailerId(document: PDFDocument): MutablePdfMetadataOccurrence {
  const originalValue = trailerIdValue(document)
  return {
    locator: 'trailer:ID',
    field: 'pdf:trailer:ID',
    category: 'document-identifier',
    valueType: 'string',
    action: 'randomize',
    replacementKind: 'trailer-id',
    originalValue,
    dateRole: null,
    setValue: (value) => {
      const [first, second] = value.split(':')
      if (!first || !second) throw new DocumentSafetyError('INTERNAL_ERROR')
      document.context.trailerInfo.ID = document.context.obj([
        PDFHexString.of(first),
        PDFHexString.of(second)
      ])
    }
  }
}

function decodeInfoValue(value: PDFObject | undefined, spec: PdfMetadataSpec): string | null {
  if (spec.replacementKind === 'trapped') {
    return value instanceof PDFName ? value.decodeText() : null
  }
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return null
  if (spec.valueType === 'timestamp') {
    try {
      return value.decodeDate().toISOString()
    } catch {
      return null
    }
  }
  return value.decodeText()
}

function setInfoValue(info: PDFDict, key: PDFName, value: string, spec: PdfMetadataSpec): void {
  if (spec.valueType === 'timestamp') {
    info.set(key, PDFString.fromDate(new Date(value)))
  } else if (spec.replacementKind === 'trapped') {
    info.set(key, PDFName.of(value))
  } else {
    info.set(key, PDFHexString.fromText(value))
  }
}

function randomizedValue(
  mapping: TaskRandomMapping,
  occurrence: MutablePdfMetadataOccurrence
): string {
  switch (occurrence.replacementKind) {
    case 'person':
      return mapping.person(occurrence.originalValue)
    case 'application':
      return mapping.application(occurrence.originalValue)
    case 'description':
      return mapping.description(occurrence.originalValue)
    case 'uuid':
      return mapping.uuid(occurrence.originalValue)
    case 'trapped':
      return mapping.enumValue(occurrence.originalValue, ['True', 'False', 'Unknown'])
    case 'trailer-id':
      return randomTrailerId(occurrence.originalValue)
    default:
      throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

function pdfCompatibleTimestamp(value: string): string {
  return new Date(Math.floor(Date.parse(value) / 1_000) * 1_000).toISOString()
}

function trailerIdValue(document: PDFDocument): string {
  const raw = document.context.trailerInfo.ID
  if (!raw) return ''
  const id = raw instanceof PDFRef ? document.context.lookup(raw) : raw
  if (!(id instanceof PDFArray) || id.size() !== 2) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  return id
    .asArray()
    .map((entry) => {
      const value = entry instanceof PDFRef ? document.context.lookup(entry) : entry
      if (!(value instanceof PDFString || value instanceof PDFHexString)) {
        throw new DocumentSafetyError('INVALID_DOCUMENT')
      }
      return Buffer.from(value.asBytes()).toString('hex')
    })
    .join(':')
}

function randomTrailerId(originalValue: string): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = `${randomBytes(16).toString('hex')}:${randomBytes(16).toString('hex')}`
    if (value !== originalValue) return value
  }
  throw new DocumentSafetyError('INTERNAL_ERROR')
}

function isValidValue(value: string, spec: PdfMetadataSpec): boolean {
  if (spec.valueType === 'timestamp') return Number.isFinite(Date.parse(value))
  if (spec.replacementKind === 'trapped') return ['True', 'False', 'Unknown'].includes(value)
  return true
}

function groupDescriptors(
  occurrences: readonly PdfMetadataOccurrence[]
): MetadataFieldDescriptor[] {
  const groups = new Map<string, MetadataFieldDescriptor>()
  for (const occurrence of occurrences) {
    const key = [
      occurrence.field,
      occurrence.category,
      occurrence.valueType,
      occurrence.action
    ].join('|')
    const existing = groups.get(key)
    if (existing) existing.occurrences += 1
    else {
      groups.set(key, {
        field: occurrence.field,
        category: occurrence.category,
        valueType: occurrence.valueType,
        occurrences: 1,
        action: occurrence.action
      })
    }
  }
  return [...groups.values()]
}

function stripSetter(occurrence: MutablePdfMetadataOccurrence): PdfMetadataOccurrence {
  return {
    locator: occurrence.locator,
    field: occurrence.field,
    category: occurrence.category,
    valueType: occurrence.valueType,
    action: occurrence.action,
    replacementKind: occurrence.replacementKind,
    originalValue: occurrence.originalValue,
    dateRole: occurrence.dateRole
  }
}

function normalizedSentinel(kind: PdfReplacementKind): string {
  if (kind === 'timestamp') return '2000-01-01T00:00:00.000Z'
  if (kind === 'uuid') return '00000000-0000-4000-8000-000000000000'
  if (kind === 'trapped') return 'Unknown'
  if (kind === 'trailer-id') return '0'.repeat(32) + ':' + '0'.repeat(32)
  return `__BID_SENTRY_${kind.toUpperCase()}__`
}

function infoSpec(
  localName: string,
  field: string,
  category: MetadataFieldCategory,
  valueType: MetadataValueType,
  replacementKind: PdfReplacementKind,
  dateRole?: Exclude<PdfDateRole, null>
): PdfMetadataSpec {
  return {
    localName,
    field,
    category,
    valueType,
    replacementKind,
    ...(dateRole ? { dateRole } : {})
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

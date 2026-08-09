import { XMLSerializer } from '@xmldom/xmldom'
import type { Document as XmlDocument } from '@xmldom/xmldom'
import type {
  MetadataFieldCategory,
  MetadataFieldDescriptor,
  MetadataValueType
} from '../../../shared/contracts'
import type { TaskRandomMapping } from '../../sanitization/randomMapping'
import { DocumentSafetyError } from '../fileSafety'
import { replaceArchiveEntries, type DocxArchive } from './archive'
import {
  customIntegerBounds,
  isValidCustomInteger,
  type CustomIntegerBounds
} from './customPropertyIntegers'
import { isWordIdentityElement } from './wordIdentityPolicy'
import { parseStrictXml } from '../xml'

const CORE_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
const DC_NS = 'http://purl.org/dc/elements/1.1/'
const DCTERMS_NS = 'http://purl.org/dc/terms/'
const APP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
const CUSTOM_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const V_TYPES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type ReplacementKind =
  | 'person'
  | 'initials'
  | 'organization'
  | 'application'
  | 'description'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'uuid'

export interface DocxMetadataOccurrence {
  partName: string
  locator: string
  field: string
  category: MetadataFieldCategory
  valueType: MetadataValueType
  action: 'randomize' | 'preserve' | 'warn'
  replacementKind: ReplacementKind | null
  originalValue: string
}

export interface DocxMetadataScan {
  fields: MetadataFieldDescriptor[]
  warnings: string[]
  occurrences: DocxMetadataOccurrence[]
}

interface MutableOccurrence extends DocxMetadataOccurrence {
  integerBounds?: CustomIntegerBounds
  setValue(value: string): void
}

interface ParsedPart {
  partName: string
  document: XmlDocument
  occurrences: MutableOccurrence[]
  warnings: string[]
}

interface ElementSpec {
  namespace: string
  localName: string
  field: string
  category: MetadataFieldCategory
  valueType: MetadataValueType
  action: 'randomize' | 'preserve'
  replacementKind: ReplacementKind | null
}

const CORE_SPECS: readonly ElementSpec[] = [
  spec(DC_NS, 'creator', 'core:creator', 'person-identity', 'string', 'person'),
  spec(CORE_NS, 'lastModifiedBy', 'core:lastModifiedBy', 'person-identity', 'string', 'person'),
  spec(DCTERMS_NS, 'created', 'core:created', 'timestamp', 'timestamp', 'timestamp'),
  spec(DCTERMS_NS, 'modified', 'core:modified', 'timestamp', 'timestamp', 'timestamp'),
  spec(CORE_NS, 'revision', 'core:revision', 'document-identifier', 'integer', 'integer'),
  spec(DC_NS, 'identifier', 'core:identifier', 'document-identifier', 'uuid', 'uuid'),
  spec(DC_NS, 'title', 'core:title', 'description', 'string', 'description'),
  spec(DC_NS, 'subject', 'core:subject', 'description', 'string', 'description'),
  spec(CORE_NS, 'keywords', 'core:keywords', 'description', 'string', 'description'),
  spec(CORE_NS, 'category', 'core:category', 'description', 'string', 'description'),
  spec(DC_NS, 'description', 'core:description', 'description', 'string', 'description'),
  spec(CORE_NS, 'contentStatus', 'core:contentStatus', 'description', 'string', 'description'),
  spec(CORE_NS, 'lastPrinted', 'core:lastPrinted', 'timestamp', 'timestamp', 'timestamp')
]

const APP_SPECS: readonly ElementSpec[] = [
  spec(APP_NS, 'Company', 'app:Company', 'organization', 'organization', 'organization'),
  spec(APP_NS, 'Manager', 'app:Manager', 'person-identity', 'string', 'person'),
  spec(APP_NS, 'Application', 'app:Application', 'application', 'string', 'application'),
  spec(APP_NS, 'AppVersion', 'app:AppVersion', 'application', 'string', 'application'),
  spec(APP_NS, 'Template', 'app:Template', 'application', 'string', 'description'),
  spec(APP_NS, 'HyperlinkBase', 'app:HyperlinkBase', 'application', 'string', 'description'),
  spec(APP_NS, 'TotalTime', 'app:TotalTime', 'application', 'integer', 'integer'),
  preserveSpec(APP_NS, 'Pages', 'app:Pages'),
  preserveSpec(APP_NS, 'Words', 'app:Words'),
  preserveSpec(APP_NS, 'Characters', 'app:Characters'),
  preserveSpec(APP_NS, 'CharactersWithSpaces', 'app:CharactersWithSpaces'),
  preserveSpec(APP_NS, 'Lines', 'app:Lines'),
  preserveSpec(APP_NS, 'Paragraphs', 'app:Paragraphs')
]

export function scanDocxMetadata(archive: DocxArchive): DocxMetadataScan {
  const parsedParts = parseMetadataParts(archive)
  const occurrences = parsedParts.flatMap((part) => part.occurrences.map(stripSetter))
  return {
    fields: groupDescriptors(occurrences),
    warnings: parsedParts.flatMap((part) => part.warnings),
    occurrences
  }
}

export function sanitizeDocxMetadata(
  archive: DocxArchive,
  mapping: TaskRandomMapping
): { archive: DocxArchive; changedParts: ReadonlySet<string> } {
  const parsedParts = parseMetadataParts(archive)
  const replacements = new Map<string, Buffer>()
  const changedParts = new Set<string>()
  const allOccurrences = parsedParts.flatMap((part) => part.occurrences)
  const handled = new Set<string>()

  const created = allOccurrences.find((occurrence) => occurrence.field === 'core:created')
  const modified = allOccurrences.find((occurrence) => occurrence.field === 'core:modified')
  if (created?.action === 'randomize' && modified?.action === 'randomize') {
    const pair = mapping.timestampPair(created.originalValue, modified.originalValue)
    created.setValue(pair.created)
    modified.setValue(pair.modified)
    handled.add(occurrenceKey(created))
    handled.add(occurrenceKey(modified))
  }

  for (const occurrence of allOccurrences) {
    if (occurrence.action !== 'randomize' || !occurrence.replacementKind) continue
    if (handled.has(occurrenceKey(occurrence))) continue
    occurrence.setValue(randomizedValue(mapping, occurrence))
  }

  for (const part of parsedParts) {
    if (!part.occurrences.some((occurrence) => occurrence.action === 'randomize')) continue
    const serialized = new XMLSerializer().serializeToString(part.document)
    replacements.set(part.partName, Buffer.from(serialized, 'utf8'))
    changedParts.add(part.partName)
  }

  return { archive: replaceArchiveEntries(archive, replacements), changedParts }
}

export function normalizeDocxMetadataPart(partName: string, contents: Buffer): string {
  const parsed = parseMetadataPart(partName, contents)
  if (!parsed) return contents.toString('base64')

  for (const occurrence of parsed.occurrences) {
    if (occurrence.action !== 'randomize' || !occurrence.replacementKind) continue
    occurrence.setValue(normalizedSentinel(occurrence.replacementKind))
  }
  return new XMLSerializer().serializeToString(parsed.document)
}

export function targetMetadataParts(archive: DocxArchive): ReadonlySet<string> {
  return new Set(
    parseMetadataParts(archive)
      .filter((part) => part.occurrences.some((occurrence) => occurrence.action === 'randomize'))
      .map((part) => part.partName)
  )
}

function parseMetadataParts(archive: DocxArchive): ParsedPart[] {
  const parts: ParsedPart[] = []
  for (const entry of archive.entries) {
    const parsed = parseMetadataPart(entry.name, entry.contents)
    if (parsed) parts.push(parsed)
  }
  return parts
}

function parseMetadataPart(partName: string, contents: Buffer): ParsedPart | null {
  if (partName === 'docProps/core.xml') {
    return parseElementSpecPart(partName, contents, CORE_SPECS)
  }
  if (partName === 'docProps/app.xml') {
    return parseElementSpecPart(partName, contents, APP_SPECS)
  }
  if (partName === 'docProps/custom.xml') {
    return parseCustomProperties(partName, contents)
  }
  if (/^word\/.*\.xml$/u.test(partName)) {
    return parseWordIdentityAttributes(partName, contents)
  }
  return null
}

function parseElementSpecPart(
  partName: string,
  contents: Buffer,
  specs: readonly ElementSpec[]
): ParsedPart {
  const document = parseStrictXml(contents)
  const occurrences: MutableOccurrence[] = []
  const warnings: string[] = []

  for (const elementSpec of specs) {
    const elements = Array.from(
      document.getElementsByTagNameNS(elementSpec.namespace, elementSpec.localName)
    )
    elements.forEach((element, index) => {
      const originalValue = element.textContent ?? ''
      let action: MetadataFieldDescriptor['action'] = elementSpec.action
      let replacementKind = elementSpec.replacementKind
      if (action === 'randomize' && !isValidValue(originalValue, elementSpec.valueType)) {
        action = 'warn'
        replacementKind = null
        warnings.push(`${elementSpec.field} 的值类型无效，已保留原值。`)
      }
      occurrences.push({
        partName,
        locator: `element:${elementSpec.namespace}:${elementSpec.localName}:${index}`,
        field: elementSpec.field,
        category: elementSpec.category,
        valueType: elementSpec.valueType,
        action,
        replacementKind,
        originalValue,
        setValue: (value) => {
          element.textContent = value
        }
      })
    })
  }

  return { partName, document, occurrences, warnings }
}

function parseCustomProperties(partName: string, contents: Buffer): ParsedPart {
  const document = parseStrictXml(contents)
  if (
    document.documentElement?.namespaceURI !== CUSTOM_NS ||
    document.documentElement.localName !== 'Properties'
  ) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  const propertyElements = Array.from(document.getElementsByTagNameNS(CUSTOM_NS, 'property'))
  const occurrences: MutableOccurrence[] = []
  const warnings: string[] = []

  propertyElements.forEach((property, index) => {
    const field = `custom:property:${index + 1}`
    const valueElements = Array.from(property.childNodes).filter((node) => node.nodeType === 1)
    const valueElement = valueElements.length === 1 ? valueElements[0] : null
    const originalValue = valueElement?.textContent ?? ''
    const customType =
      valueElement?.namespaceURI === V_TYPES_NS && 'localName' in valueElement
        ? customPropertyType(String(valueElement.localName))
        : null
    if (!valueElement || !customType || !isValidCustomValue(originalValue, customType)) {
      warnings.push(`${field} 的自定义属性类型不受支持或值无效，已保留原值。`)
      occurrences.push({
        partName,
        locator: `custom:${index}`,
        field,
        category: 'custom-property',
        valueType: customType?.valueType ?? 'string',
        action: 'warn',
        replacementKind: null,
        originalValue,
        setValue: () => undefined
      })
      return
    }

    occurrences.push({
      partName,
      locator: `custom:${index}`,
      field,
      category: 'custom-property',
      valueType: customType.valueType,
      action: 'randomize',
      replacementKind: customType.replacementKind,
      originalValue,
      ...(customType.integerBounds ? { integerBounds: customType.integerBounds } : {}),
      setValue: (value) => {
        valueElement.textContent = value
      }
    })
  })

  return { partName, document, occurrences, warnings }
}

function parseWordIdentityAttributes(partName: string, contents: Buffer): ParsedPart {
  const document = parseStrictXml(contents)
  const elements = Array.from(document.getElementsByTagName('*')).filter(
    (element) => element.namespaceURI === WORD_NS && isWordIdentityElement(element.localName)
  )
  const occurrences: MutableOccurrence[] = []
  const warnings: string[] = []

  elements.forEach((element, elementIndex) => {
    for (const attribute of ['author', 'initials', 'date'] as const) {
      if (!element.hasAttributeNS(WORD_NS, attribute)) continue
      const originalValue = element.getAttributeNS(WORD_NS, attribute) ?? ''
      const isDate = attribute === 'date'
      const valueType = isDate ? 'timestamp' : attribute === 'initials' ? 'initials' : 'string'
      const replacementKind = isDate
        ? 'timestamp'
        : attribute === 'initials'
          ? 'initials'
          : 'person'
      const isValid = isValidValue(originalValue, valueType)
      if (!isValid) {
        warnings.push(`${partName}:w:${attribute} 的值类型无效，已保留原值。`)
      }
      occurrences.push({
        partName,
        locator: `word-element:${elementIndex}:attribute:${attribute}`,
        field: `${partName}:w:${attribute}`,
        category: isDate
          ? 'timestamp'
          : partName.includes('comments')
            ? 'comment-identity'
            : 'revision-identity',
        valueType,
        action: isValid ? 'randomize' : 'warn',
        replacementKind: isValid ? replacementKind : null,
        originalValue,
        setValue: (value) => element.setAttributeNS(WORD_NS, `w:${attribute}`, value)
      })
    }
  })

  return { partName, document, occurrences, warnings }
}

function randomizedValue(mapping: TaskRandomMapping, occurrence: MutableOccurrence): string {
  switch (occurrence.replacementKind) {
    case 'person':
      return mapping.person(occurrence.originalValue)
    case 'initials':
      return mapping.initials(occurrence.originalValue)
    case 'organization':
      return mapping.organization(occurrence.originalValue)
    case 'application':
      return mapping.application(occurrence.originalValue)
    case 'description':
      return mapping.description(occurrence.originalValue)
    case 'uuid':
      return mapping.uuid(occurrence.originalValue)
    case 'integer':
      return occurrence.integerBounds
        ? String(
            mapping.integerInRange(
              occurrence.originalValue,
              occurrence.integerBounds.generationMin,
              occurrence.integerBounds.generationMax
            )
          )
        : String(mapping.integer(Number.parseInt(occurrence.originalValue, 10)))
    case 'number':
      return String(mapping.number(Number(occurrence.originalValue)))
    case 'boolean':
      return String(mapping.boolean(parseBoolean(occurrence.originalValue)))
    case 'timestamp':
      return mapping.timestamp(occurrence.originalValue)
    default:
      throw new DocumentSafetyError('INTERNAL_ERROR')
  }
}

function normalizedSentinel(kind: ReplacementKind): string {
  if (kind === 'integer') return '0'
  if (kind === 'number') return '0.5'
  if (kind === 'boolean') return 'false'
  if (kind === 'timestamp') return '2000-01-01T00:00:00.000Z'
  if (kind === 'uuid') return '00000000-0000-4000-8000-000000000000'
  return `__BID_SENTRY_${kind.toUpperCase()}__`
}

function customPropertyType(localName: string): {
  valueType: MetadataValueType
  replacementKind: ReplacementKind
  integerBounds?: CustomIntegerBounds
} | null {
  if (['lpwstr', 'lpstr', 'bstr'].includes(localName)) {
    return { valueType: 'string', replacementKind: 'description' }
  }
  const integerBounds = customIntegerBounds(localName)
  if (integerBounds) {
    return { valueType: 'integer', replacementKind: 'integer', integerBounds }
  }
  if (['r4', 'r8', 'decimal', 'cy'].includes(localName)) {
    return { valueType: 'number', replacementKind: 'number' }
  }
  if (localName === 'bool') return { valueType: 'boolean', replacementKind: 'boolean' }
  if (localName === 'filetime' || localName === 'date') {
    return { valueType: 'timestamp', replacementKind: 'timestamp' }
  }
  return null
}

function isValidCustomValue(
  value: string,
  customType: NonNullable<ReturnType<typeof customPropertyType>>
): boolean {
  return customType.integerBounds
    ? isValidCustomInteger(value, customType.integerBounds)
    : isValidValue(value, customType.valueType)
}

function isValidValue(value: string, valueType: MetadataValueType): boolean {
  if (valueType === 'integer') return /^-?\d+$/u.test(value.trim())
  if (valueType === 'number') {
    return value.trim() !== '' && Number.isFinite(Number(value.trim()))
  }
  if (valueType === 'boolean') return /^(true|false|0|1)$/iu.test(value.trim())
  if (valueType === 'timestamp') return Number.isFinite(Date.parse(value))
  return true
}

function parseBoolean(value: string): boolean {
  return /^(true|1)$/iu.test(value.trim())
}

function groupDescriptors(
  occurrences: readonly DocxMetadataOccurrence[]
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
    if (existing) {
      existing.occurrences += 1
    } else {
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

function occurrenceKey(occurrence: DocxMetadataOccurrence): string {
  return `${occurrence.partName}|${occurrence.locator}`
}

function stripSetter(occurrence: MutableOccurrence): DocxMetadataOccurrence {
  return {
    partName: occurrence.partName,
    locator: occurrence.locator,
    field: occurrence.field,
    category: occurrence.category,
    valueType: occurrence.valueType,
    action: occurrence.action,
    replacementKind: occurrence.replacementKind,
    originalValue: occurrence.originalValue
  }
}

function spec(
  namespace: string,
  localName: string,
  field: string,
  category: MetadataFieldCategory,
  valueType: MetadataValueType,
  replacementKind: ReplacementKind
): ElementSpec {
  return { namespace, localName, field, category, valueType, action: 'randomize', replacementKind }
}

function preserveSpec(namespace: string, localName: string, field: string): ElementSpec {
  return {
    namespace,
    localName,
    field,
    category: 'other',
    valueType: 'integer',
    action: 'preserve',
    replacementKind: null
  }
}

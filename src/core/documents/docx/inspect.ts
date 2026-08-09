import { posix } from 'node:path'
import type { Document as XmlDocument } from '@xmldom/xmldom'
import type { DocumentInspection } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { archiveEntryMap, type DocxArchive, type DocxArchiveEntry } from './archive'
import { scanDocxMetadata } from './metadata'
import { parseStrictXml } from './xml'

const WORD_MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

export interface DocxInspection extends DocumentInspection {
  documentType: 'docx'
}

export function inspectDocxArchive(archive: DocxArchive): DocxInspection {
  const entries = archiveEntryMap(archive)
  const contentTypes = entries.get('[Content_Types].xml')
  const rootRelationships = entries.get('_rels/.rels')
  const mainDocument = entries.get('word/document.xml')
  if (!contentTypes || !rootRelationships || !mainDocument) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const contentTypesDocument = parseStrictXml(contentTypes.contents)
  assertRootElement(contentTypesDocument, CONTENT_TYPES_NS, 'Types')
  const overrides = Array.from(
    contentTypesDocument.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override')
  )
  const mainOverride = overrides.find(
    (override) => override.getAttribute('PartName') === '/word/document.xml'
  )
  if (!mainOverride || mainOverride.getAttribute('ContentType') !== WORD_MAIN_CONTENT_TYPE) {
    throw new DocumentSafetyError('UNSUPPORTED_TYPE')
  }
  if (
    overrides.some((override) =>
      override.getAttribute('ContentType')?.toLowerCase().includes('macroenabled')
    ) ||
    archive.entries.some((entry) => /(^|\/)vbaProject\.bin$/iu.test(entry.name))
  ) {
    throw new DocumentSafetyError('UNSUPPORTED_TYPE')
  }
  if (
    archive.entries.some((entry) => entry.name.toLowerCase().startsWith('_xmlsignatures/')) ||
    overrides.some((override) =>
      override.getAttribute('ContentType')?.toLowerCase().includes('digital-signature')
    )
  ) {
    throw new DocumentSafetyError('SIGNED_DOCUMENT')
  }

  const relationshipDocument = parseStrictXml(rootRelationships.contents)
  assertRootElement(relationshipDocument, RELATIONSHIPS_NS, 'Relationships')
  const relationships = Array.from(
    relationshipDocument.getElementsByTagNameNS(RELATIONSHIPS_NS, 'Relationship')
  )
  const mainRelationships = relationships.filter(
    (relationship) => relationship.getAttribute('Type')?.endsWith('/officeDocument') === true
  )
  const validInternalMainRelationships = mainRelationships.filter(
    (relationship) =>
      relationship.getAttribute('Target')?.replace(/^\//u, '') === 'word/document.xml' &&
      relationship.getAttribute('TargetMode') !== 'External'
  )
  if (mainRelationships.length !== 1 || validInternalMainRelationships.length !== 1) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  const externalRelationshipCount = validatePackageRelationships(archive, entries)
  const metadata = scanDocxMetadata(archive)
  const warnings = [...metadata.warnings]
  if (externalRelationshipCount > 0) {
    warnings.push(`检测到 ${externalRelationshipCount} 个外部关系，已保留并建议人工检查。`)
  }
  if (archive.entries.some((entry) => entry.name.startsWith('customXml/'))) {
    warnings.push('检测到 customXml 内容，已原样保留。')
  }

  return {
    documentType: 'docx',
    fields: metadata.fields,
    warnings,
    blockers: []
  }
}

function validatePackageRelationships(
  archive: DocxArchive,
  entries: ReadonlyMap<string, DocxArchiveEntry>
): number {
  let externalCount = 0
  for (const entry of archive.entries.filter((candidate) => candidate.name.endsWith('.rels'))) {
    const sourcePart = relationshipSourcePart(entry.name)
    const sourceEntry = sourcePart ? entries.get(sourcePart) : null
    if (sourcePart === null || (sourcePart !== '' && (!sourceEntry || sourceEntry.isDirectory))) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }
    const document = parseStrictXml(entry.contents)
    assertRootElement(document, RELATIONSHIPS_NS, 'Relationships')
    const relationships = Array.from(
      document.getElementsByTagNameNS(RELATIONSHIPS_NS, 'Relationship')
    )
    for (const relationship of relationships) {
      if (
        relationship.getAttribute('Type')?.toLowerCase().includes('/digital-signature/') === true
      ) {
        throw new DocumentSafetyError('SIGNED_DOCUMENT')
      }
      if (relationship.getAttribute('TargetMode') === 'External') {
        externalCount += 1
        continue
      }
      const target = relationship.getAttribute('Target')
      const resolvedTarget = target ? resolveRelationshipTarget(sourcePart, target) : null
      const targetEntry = resolvedTarget ? entries.get(resolvedTarget) : null
      if (!targetEntry || targetEntry.isDirectory) {
        throw new DocumentSafetyError('INVALID_DOCUMENT')
      }
    }
  }
  return externalCount
}

function resolveRelationshipTarget(sourcePart: string, target: string): string | null {
  const targetPath = target.split(/[?#]/u, 1)[0]
  if (!targetPath || /%(?:2e|2f|5c)/iu.test(targetPath)) return null
  try {
    const decodedTarget = decodeURIComponent(targetPath)
    if (
      /%[\da-f]{2}/iu.test(decodedTarget) ||
      decodedTarget.includes('\\') ||
      decodedTarget.includes('\0') ||
      /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decodedTarget)
    ) {
      return null
    }
    const resolvedSegments = decodedTarget.startsWith('/')
      ? []
      : posix
          .dirname(sourcePart)
          .split('/')
          .filter((segment) => segment !== '.')
    for (const segment of decodedTarget.split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        if (resolvedSegments.length === 0) return null
        resolvedSegments.pop()
      } else {
        resolvedSegments.push(segment)
      }
    }
    return resolvedSegments.length > 0 ? resolvedSegments.join('/') : null
  } catch {
    return null
  }
}

function relationshipSourcePart(relationshipPartName: string): string | null {
  if (relationshipPartName === '_rels/.rels') return ''
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/u.exec(relationshipPartName)
  if (!match) return null
  return `${match[1] ?? ''}${match[2] ?? ''}`
}

function assertRootElement(document: XmlDocument, namespace: string, localName: string): void {
  if (
    document.documentElement?.namespaceURI !== namespace ||
    document.documentElement.localName !== localName
  ) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
}

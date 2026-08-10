import { XMLSerializer, type Element } from '@xmldom/xmldom'
import { posix } from 'node:path'
import { TaskRandomMapping } from '../sanitization/randomMapping'
import { DocumentSafetyError } from '../documents/fileSafety'
import {
  readDocxArchive,
  writeDocxArchive,
  type DocxArchive,
  type DocxArchiveEntry
} from '../documents/docx/archive'
import { inspectDocxArchive } from '../documents/docx/inspect'
import { parseStrictXml } from '../documents/xml'
import { sanitizeDocxMetadata } from '../documents/docx/metadata'
import type { DocumentSnapshot, FieldAction, TemplateCandidate } from '../../shared/contracts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'

/**
 * Writes only the user-confirmed template range to a temporary DOCX path.
 * The caller is responsible for publishing that temporary path after a fresh
 * verification report has passed.
 */
export async function generateDocxFromTemplate(
  inputPath: string,
  outputPath: string,
  document: DocumentSnapshot,
  candidate: TemplateCandidate,
  actions: readonly FieldAction[],
  signal?: AbortSignal
): Promise<void> {
  const archive = await readDocxArchive(inputPath, signal)
  inspectDocxArchive(archive)
  const entry = archive.entries.find(
    (candidateEntry) => candidateEntry.name === 'word/document.xml'
  )
  if (!entry) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const xml = parseStrictXml(entry.contents)
  const selectedNodeIds = selectedNodes(document, candidate)
  if (selectedNodeIds.size === 0) throw new DocumentSafetyError('INVALID_REQUEST')
  applyActions(xml, actions, selectedNodeIds)
  cropDocumentBody(xml, document, selectedNodeIds)
  stripForbiddenElements(xml)

  const croppedArchive = cropGenerationArchive(
    archive,
    Buffer.from(new XMLSerializer().serializeToString(xml), 'utf8')
  )
  const mapping = new TaskRandomMapping()
  try {
    const sanitized = sanitizeDocxMetadata(croppedArchive, mapping)
    await writeDocxArchive(sanitized.archive, outputPath, signal)
  } finally {
    mapping.destroy()
  }
}

export async function generateMinimalDocxFromPdf(
  outputPath: string,
  document: DocumentSnapshot,
  candidate: TemplateCandidate,
  actions: readonly FieldAction[],
  signal?: AbortSignal
): Promise<void> {
  const selected = selectedDocumentNodes(document, candidate)
  if (selected.length === 0) throw new DocumentSafetyError('INVALID_REQUEST')
  const blocks = groupPdfNodes(selected)
  let previousPage: number | undefined
  const bodyMarkup = blocks
    .map((block) => {
      const page = block.nodes[0]?.anchor.page
      const pageBreak = page !== undefined && previousPage !== undefined && page !== previousPage
      if (page !== undefined) previousPage = page
      return block.table
        ? renderPdfTable(block.nodes, actions, pageBreak)
        : renderPdfParagraph(block.nodes[0]!, actions, pageBreak)
    })
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyMarkup}<w:sectPr/></w:body></w:document>`
  const archive: DocxArchive = {
    entries: [
      entry(
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      entry(
        '_rels/.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ),
      entry('word/document.xml', documentXml),
      entry(
        'word/_rels/document.xml.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
      ),
      entry(
        'docProps/core.xml',
        '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bid Sentry qualification draft</dc:title></cp:coreProperties>'
      ),
      entry(
        'docProps/app.xml',
        '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Bid Sentry</Application></Properties>'
      )
    ]
  }
  await writeDocxArchive(archive, outputPath, signal)
}

interface PdfGenerationBlock {
  nodes: DocumentSnapshot['nodes']
  table: boolean
}

function groupPdfNodes(nodes: DocumentSnapshot['nodes']): PdfGenerationBlock[] {
  const blocks: PdfGenerationBlock[] = []
  for (const node of nodes) {
    const last = blocks.at(-1)
    const previous = last?.nodes.at(-1)
    if (
      last &&
      previous &&
      !last.table &&
      previous.kind === 'paragraph' &&
      node.kind === 'paragraph' &&
      previous.anchor.page !== undefined &&
      previous.anchor.page === node.anchor.page &&
      samePdfBaseline(previous, node) &&
      pdfColumnGap(previous, node) >= 48
    ) {
      last.nodes.push(node)
      last.table = true
      continue
    }
    blocks.push({ nodes: [node], table: false })
  }
  return blocks
}

function samePdfBaseline(
  left: DocumentSnapshot['nodes'][number],
  right: DocumentSnapshot['nodes'][number]
): boolean {
  const leftBox = left.anchor.bbox
  const rightBox = right.anchor.bbox
  if (!leftBox || !rightBox) return false
  return (
    Math.abs(leftBox.y - rightBox.y) <= Math.max(4, Math.min(leftBox.height, rightBox.height) * 0.5)
  )
}

function pdfColumnGap(
  left: DocumentSnapshot['nodes'][number],
  right: DocumentSnapshot['nodes'][number]
): number {
  const leftBox = left.anchor.bbox
  const rightBox = right.anchor.bbox
  if (!leftBox || !rightBox) return 0
  return rightBox.x - (leftBox.x + leftBox.width)
}

function renderPdfParagraph(
  node: DocumentSnapshot['nodes'][number],
  actions: readonly FieldAction[],
  pageBreakBefore: boolean
): string {
  const text = actions
    .filter((candidateAction) => candidateAction.targetNodeId === node.nodeId)
    .reduce((current, action) => applyFieldAction(current, action), node.text)
  const paragraphProperties = [
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    node.kind === 'heading'
      ? `<w:pStyle w:val="Heading${Math.min(6, Math.max(1, node.level ?? 1))}"/>`
      : ''
  ].join('')
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

function renderPdfTable(
  nodes: readonly DocumentSnapshot['nodes'][number][],
  actions: readonly FieldAction[],
  pageBreakBefore: boolean
): string {
  const cells = nodes
    .map((node, index) => {
      const paragraph = renderPdfParagraph(node, actions, pageBreakBefore && index === 0)
      return `<w:tc><w:tcPr><w:tcW w:type="auto" w:w="0"/></w:tcPr>${paragraph}</w:tc>`
    })
    .join('')
  return `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tr>${cells}</w:tr></w:tbl>`
}

export function selectedDocumentNodes(
  document: DocumentSnapshot,
  candidate: TemplateCandidate
): DocumentSnapshot['nodes'] {
  const start = document.nodes.findIndex((node) => node.nodeId === candidate.startNodeId)
  const end = document.nodes.findIndex((node) => node.nodeId === candidate.endNodeId)
  if (start < 0 || end < start) return []
  return document.nodes
    .slice(start, end + 1)
    .filter((node) => node.kind !== 'header' && node.kind !== 'footer' && node.kind !== 'table')
}

function selectedNodes(document: DocumentSnapshot, candidate: TemplateCandidate): Set<string> {
  return new Set(selectedDocumentNodes(document, candidate).map((node) => node.nodeId))
}

function applyActions(
  xml: ReturnType<typeof parseStrictXml>,
  actions: readonly FieldAction[],
  selectedNodeIds: ReadonlySet<string>
): void {
  const paragraphs = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p'))
  let paragraphIndex = 0
  const paragraphIds = new Map<object, string>()
  for (const paragraph of paragraphs) {
    if (isInsideTable(paragraph)) continue
    paragraphIds.set(paragraph, `p-${paragraphIndex}`)
    paragraphIndex += 1
  }
  const tables = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'tbl'))
  const cells = new Map<string, object>()
  tables.forEach((table, tableIndex) => {
    const rows = Array.from(table.getElementsByTagNameNS(WORD_NS, 'tr'))
    rows.forEach((row, rowIndex) => {
      const rowCells = Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc'))
      rowCells.forEach((cell, cellIndex) => {
        cells.set(`cell-${tableIndex}-${rowIndex}-${cellIndex}`, cell)
      })
    })
  })
  for (const action of actions) {
    if (!selectedNodeIds.has(action.targetNodeId)) {
      throw new DocumentSafetyError('PLAN_EXPIRED')
    }
    const target = action.targetNodeId.match(/^p-(\d+)$/u)
      ? paragraphs.find((paragraph) => paragraphIds.get(paragraph) === action.targetNodeId)
      : cells.get(action.targetNodeId)
    if (!target) throw new DocumentSafetyError('PLAN_EXPIRED')
    const text = ensureTextNodes(target as Element)
    const original = text.map((node) => node.textContent ?? '').join('')
    applyFieldActionToTextNodes(text, original, action)
  }
}

function cropDocumentBody(
  xml: ReturnType<typeof parseStrictXml>,
  document: DocumentSnapshot,
  selectedNodeIds: ReadonlySet<string>
): void {
  const body = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'body'))[0]
  if (!body) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const paragraphs = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'p'))
  const paragraphIds = new Map<object, string>()
  let paragraphIndex = 0
  for (const paragraph of paragraphs) {
    if (isInsideTable(paragraph)) continue
    paragraphIds.set(paragraph, `p-${paragraphIndex}`)
    paragraphIndex += 1
  }
  const directChildren = Array.from(body.childNodes).filter(
    (node): node is Element => node.nodeType === 1
  )
  const directChildIndexes = new Map<object, number>(
    directChildren.map((child, index) => [child, index])
  )
  const tables = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'tbl'))
  const tableIds = new Map<object, string>()
  const cellIds = new Map<object, string>()
  tables.forEach((table, tableIndex) => {
    tableIds.set(table, `table-${tableIndex}`)
    Array.from(table.getElementsByTagNameNS(WORD_NS, 'tr')).forEach((row, rowIndex) => {
      Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc')).forEach((cell, cellIndex) => {
        cellIds.set(cell, `cell-${tableIndex}-${rowIndex}-${cellIndex}`)
      })
    })
  })
  const selectedBodyChildIndexes = new Set<number>()
  for (const [paragraph, nodeId] of paragraphIds) {
    if (!selectedNodeIds.has(nodeId)) continue
    const owner = topLevelBodyChild(paragraph, body)
    const index = owner ? directChildIndexes.get(owner) : undefined
    if (index !== undefined) selectedBodyChildIndexes.add(index)
  }
  for (const [table, nodeId] of tableIds) {
    if (!selectedNodeIds.has(nodeId)) continue
    const owner = topLevelBodyChild(table, body)
    const index = owner ? directChildIndexes.get(owner) : undefined
    if (index !== undefined) selectedBodyChildIndexes.add(index)
  }
  for (const [cell, nodeId] of cellIds) {
    if (!selectedNodeIds.has(nodeId)) continue
    const owner = topLevelBodyChild(cell, body)
    const index = owner ? directChildIndexes.get(owner) : undefined
    if (index !== undefined) selectedBodyChildIndexes.add(index)
  }
  const sourceSectionProperties = findTerminalSectionProperties(
    body,
    directChildren,
    paragraphs,
    selectedBodyChildIndexes
  )
  const terminalSectionProperties = cloneSectionProperties(sourceSectionProperties)
  for (const child of directChildren) {
    const element = child as typeof body
    if (element.localName === 'sectPr') continue
    if (element.localName === 'p') {
      if (!paragraphIds.has(element) || !selectedNodeIds.has(paragraphIds.get(element)!)) {
        body.removeChild(element)
      }
      continue
    }
    if (element.localName === 'tbl') {
      const tableId = tableIds.get(element)
      const selectedCells = Array.from(cellIds.entries()).filter(
        ([cell, id]) => cellIsDescendant(cell, element) && selectedNodeIds.has(id)
      )
      if (tableId && selectedNodeIds.has(tableId)) continue
      if (!selectedCells.length) {
        body.removeChild(element)
        continue
      }
      const selectedCellSet = new Set(selectedCells.map(([cell]) => cell))
      for (const row of Array.from(element.getElementsByTagNameNS(WORD_NS, 'tr'))) {
        const rowCells = Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc'))
        for (const cell of rowCells) {
          if (!selectedCellSet.has(cell)) row.removeChild(cell)
        }
        if (!Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc')).length)
          row.parentNode?.removeChild(row)
      }
      continue
    }
    if (element.localName === 'sdt') {
      const selectedDescendant =
        Array.from(element.getElementsByTagNameNS(WORD_NS, 'p')).some((paragraph) =>
          selectedNodeIds.has(paragraphIds.get(paragraph) ?? '')
        ) ||
        Array.from(cellIds.entries()).some(
          ([cell, id]) => cellIsDescendant(cell, element) && selectedNodeIds.has(id)
        )
      if (!selectedDescendant) body.removeChild(element)
      continue
    }
    body.removeChild(element)
  }
  const existingBodySectionProperties = directChildren.find((child) => child.localName === 'sectPr')
  if (sourceSectionProperties !== existingBodySectionProperties) {
    sourceSectionProperties.parentNode?.removeChild(sourceSectionProperties)
  }
  if (existingBodySectionProperties) {
    body.replaceChild(terminalSectionProperties, existingBodySectionProperties)
  } else {
    body.appendChild(terminalSectionProperties)
  }
  // Page headers and footers are section-level dependencies of the selected
  // template. The final body-level section properties must belong to the
  // section containing the selected range; otherwise a later section's
  // header/footer relationships would leak into the generated template.
  if (
    !Array.from(body.childNodes).some(
      (node) =>
        node.nodeType === 1 && ['p', 'tbl', 'sdt'].includes((node as typeof body).localName ?? '')
    )
  ) {
    throw new DocumentSafetyError('INVALID_REQUEST')
  }
  // Keep this readback as an explicit range proof for callers and tests.
  if (!document.nodes.some((node) => selectedNodeIds.has(node.nodeId))) {
    throw new DocumentSafetyError('INVALID_REQUEST')
  }
}

function topLevelBodyChild(node: object, body: Element): Element | undefined {
  let current: object | null = node
  while (current) {
    const parent: object | null = (current as { parentNode?: object | null }).parentNode ?? null
    if (parent === body) return current as Element
    current = parent
  }
  return undefined
}

function findTerminalSectionProperties(
  body: Element,
  directChildren: readonly Element[],
  paragraphs: readonly Element[],
  selectedBodyChildIndexes: ReadonlySet<number>
): Element {
  const latestSelectedIndex = Math.max(...selectedBodyChildIndexes)
  if (!Number.isFinite(latestSelectedIndex)) throw new DocumentSafetyError('INVALID_REQUEST')
  const directChildIndexes = new Map<object, number>(
    directChildren.map((child, index) => [child, index])
  )
  const terminators = paragraphs
    .map((paragraph, paragraphOrder) => {
      const sectionProperties = directParagraphSectionProperties(paragraph)
      if (!sectionProperties) return undefined
      const owner = topLevelBodyChild(paragraph, body)
      const bodyChildIndex = owner ? directChildIndexes.get(owner) : undefined
      return bodyChildIndex === undefined
        ? undefined
        : { sectionProperties, bodyChildIndex, paragraphOrder }
    })
    .filter(
      (
        value
      ): value is {
        sectionProperties: Element
        bodyChildIndex: number
        paragraphOrder: number
      } => value !== undefined
    )
    .filter(({ bodyChildIndex }) => bodyChildIndex >= latestSelectedIndex)
    .sort(
      (left, right) =>
        left.bodyChildIndex - right.bodyChildIndex || left.paragraphOrder - right.paragraphOrder
    )
  if (terminators[0]) return terminators[0].sectionProperties
  const bodySectionProperties = directChildren.find((child) => child.localName === 'sectPr')
  if (!bodySectionProperties) throw new DocumentSafetyError('INVALID_DOCUMENT')
  return bodySectionProperties
}

function directParagraphSectionProperties(paragraph: Element): Element | undefined {
  const paragraphProperties = Array.from(paragraph.childNodes).find(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === 'pPr'
  )
  if (!paragraphProperties) return undefined
  return Array.from(paragraphProperties.childNodes).find(
    (node): node is Element => node.nodeType === 1 && (node as Element).localName === 'sectPr'
  )
}

function cloneSectionProperties(sectionProperties: Element): Element {
  return sectionProperties.cloneNode(true) as Element
}

function cropGenerationArchive(archive: DocxArchive, documentXml: Buffer): DocxArchive {
  const forbidden = new Set(
    archive.entries.map((entry) => entry.name).filter((name) => isForbiddenGenerationPart(name))
  )
  const entriesByName = new Map(archive.entries.map((entry) => [entry.name, entry]))
  // Filter note bodies before walking their relationship IDs.  Otherwise an
  // unselected footnote/endnote can keep its image or hyperlink media alive
  // through the dependency graph even though its note element is removed.
  for (const [partName, kind] of [
    ['word/footnotes.xml', 'footnote'],
    ['word/endnotes.xml', 'endnote']
  ] as const) {
    const noteEntry = entriesByName.get(partName)
    if (noteEntry) {
      entriesByName.set(partName, {
        ...noteEntry,
        contents: filterNotesPart(noteEntry, documentXml, kind)
      })
    }
  }
  const retained = new Set<string>([
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'docProps/core.xml',
    'docProps/app.xml'
  ])
  const relationshipQueue: Array<{
    partName: string
    relationshipPart: string
    usedIds: ReadonlySet<string> | null
  }> = [
    { partName: '', relationshipPart: '_rels/.rels', usedIds: null },
    {
      partName: 'word/document.xml',
      relationshipPart: 'word/_rels/document.xml.rels',
      usedIds: relationshipIds(parseStrictXml(documentXml))
    }
  ]
  const visitedRelationshipParts = new Set<string>()

  const walkRelationships = (): void => {
    while (relationshipQueue.length > 0) {
      const next = relationshipQueue.shift()!
      if (visitedRelationshipParts.has(next.relationshipPart)) continue
      visitedRelationshipParts.add(next.relationshipPart)
      const relationshipEntry = entriesByName.get(next.relationshipPart)
      if (!relationshipEntry) continue
      const relationshipDocument = parseStrictXml(relationshipEntry.contents)
      const relationships = Array.from(
        relationshipDocument.getElementsByTagNameNS(REL_NS, 'Relationship')
      )
      for (const relationship of relationships) {
        if (
          next.relationshipPart === '_rels/.rels' &&
          !ALLOWED_ROOT_RELATIONSHIP_TYPES.has(relationship.getAttribute('Type') ?? '')
        ) {
          continue
        }
        const targetMode = relationship.getAttribute('TargetMode')
        const id = relationship.getAttribute('Id')
        if (!id) throw new DocumentSafetyError('INVALID_DOCUMENT')
        if (targetMode === 'External') {
          if (next.usedIds?.has(id)) throw new DocumentSafetyError('UNSAFE_ARCHIVE')
          continue
        }
        if (next.usedIds && !next.usedIds.has(id)) continue
        const target = relationship.getAttribute('Target')
        const resolved = target ? resolveRelationshipTarget(next.relationshipPart, target) : null
        if (!resolved || forbidden.has(resolved)) {
          if (next.usedIds?.has(id)) throw new DocumentSafetyError('UNSAFE_ARCHIVE')
          continue
        }
        const targetEntry = entriesByName.get(resolved)
        if (!targetEntry || targetEntry.isDirectory) {
          throw new DocumentSafetyError('INVALID_DOCUMENT')
        }
        retained.add(resolved)
        const targetRelationshipPart = relationshipPartForSource(resolved)
        if (targetRelationshipPart) {
          retained.add(targetRelationshipPart)
          relationshipQueue.push({
            partName: resolved,
            relationshipPart: targetRelationshipPart,
            usedIds: relationshipIdsFromEntry(targetEntry)
          })
        }
      }
    }
  }
  walkRelationships()

  // These package parts are implicit Word dependencies rather than explicit
  // r:id targets in document.xml. Keep only the standard structural parts;
  // arbitrary unreferenced attachments are intentionally excluded.
  for (const entry of archive.entries) {
    if (!isImplicitGenerationPart(entry.name, documentXml) || forbidden.has(entry.name)) continue
    retained.add(entry.name)
  }
  for (const name of retained) {
    if (!name.endsWith('.xml')) continue
    const relationshipPart = relationshipPartForSource(name)
    const relationshipEntry = relationshipPart ? entriesByName.get(relationshipPart) : undefined
    if (!relationshipPart || !relationshipEntry) continue
    retained.add(relationshipPart)
    relationshipQueue.push({
      partName: name,
      relationshipPart,
      usedIds: relationshipIdsFromEntry(entriesByName.get(name)!)
    })
  }
  walkRelationships()

  const entries = archive.entries.filter((entry) => {
    if (forbidden.has(entry.name)) return false
    if (entry.isDirectory) {
      return [...retained].some((name) => name.startsWith(entry.name))
    }
    return retained.has(entry.name)
  })
  const retainedEntryNames = new Set(entries.map((entry) => entry.name))
  const removed = new Set(
    archive.entries.map((entry) => entry.name).filter((name) => !retainedEntryNames.has(name))
  )
  const replacements = new Map<string, Buffer>([['word/document.xml', documentXml]])
  for (const entry of entries) {
    if (entry.name.endsWith('.rels')) {
      replacements.set(entry.name, filterRelationships(entry, removed, retained))
    } else if (entry.name === '[Content_Types].xml') {
      replacements.set(entry.name, filterContentTypes(entry, removed))
    } else if (entry.name === 'word/footnotes.xml') {
      replacements.set(entry.name, filterNotesPart(entry, documentXml, 'footnote'))
    } else if (entry.name === 'word/endnotes.xml') {
      replacements.set(entry.name, filterNotesPart(entry, documentXml, 'endnote'))
    }
  }
  return {
    entries: entries.map((entry) => ({
      ...entry,
      contents: replacements.get(entry.name) ?? entry.contents
    }))
  }
}

function filterRelationships(
  entry: DocxArchiveEntry,
  removed: ReadonlySet<string>,
  retained: ReadonlySet<string>
): Buffer {
  const xml = parseStrictXml(entry.contents)
  const relationships = Array.from(xml.getElementsByTagNameNS(REL_NS, 'Relationship'))
  for (const relationship of relationships) {
    if (relationship.getAttribute('TargetMode') === 'External') {
      relationship.parentNode?.removeChild(relationship)
      continue
    }
    const target = relationship.getAttribute('Target')
    const resolved = target ? resolveRelationshipTarget(entry.name, target) : null
    if (!resolved || removed.has(resolved) || !retained.has(resolved)) {
      relationship.parentNode?.removeChild(relationship)
    }
  }
  return Buffer.from(new XMLSerializer().serializeToString(xml), 'utf8')
}

function filterContentTypes(entry: DocxArchiveEntry, removed: ReadonlySet<string>): Buffer {
  const xml = parseStrictXml(entry.contents)
  for (const override of Array.from(xml.getElementsByTagNameNS(CONTENT_TYPES_NS, 'Override'))) {
    const partName = override.getAttribute('PartName')?.replace(/^\//u, '')
    if (partName && removed.has(partName)) override.parentNode?.removeChild(override)
  }
  return Buffer.from(new XMLSerializer().serializeToString(xml), 'utf8')
}

export function isForbiddenGenerationPart(name: string): boolean {
  return /^(?:customXml\/|word\/(?:comments(?:Extended)?(?:\.xml)?|commentsIds\.xml|embeddings\/|people\/|vbaProject\.bin$|activeX\/|glossary\/|afchunk\/))/iu.test(
    name
  )
}

const ALLOWED_ROOT_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties'
])

function isImplicitGenerationPart(name: string, documentXml: Buffer): boolean {
  if (
    /^word\/(?:styles\.xml|numbering\.xml|settings\.xml|fontTable\.xml|webSettings\.xml|theme\/[^/]+\.xml)$/iu.test(
      name
    )
  ) {
    return true
  }
  if (name === 'word/footnotes.xml') {
    return (
      parseStrictXml(documentXml).getElementsByTagNameNS(WORD_NS, 'footnoteReference').length > 0
    )
  }
  if (name === 'word/endnotes.xml') {
    return (
      parseStrictXml(documentXml).getElementsByTagNameNS(WORD_NS, 'endnoteReference').length > 0
    )
  }
  return false
}

function filterNotesPart(
  entry: DocxArchiveEntry,
  documentXml: Buffer,
  kind: 'footnote' | 'endnote'
): Buffer {
  const document = parseStrictXml(documentXml)
  const noteIds = new Set(
    Array.from(document.getElementsByTagNameNS(WORD_NS, `${kind}Reference`))
      .map((reference) => reference.getAttributeNS(WORD_NS, 'id'))
      .filter((id): id is string => Boolean(id))
  )
  const notes = parseStrictXml(entry.contents)
  for (const note of Array.from(notes.getElementsByTagNameNS(WORD_NS, kind))) {
    const id = note.getAttributeNS(WORD_NS, 'id') ?? ''
    if (id !== '-1' && id !== '0' && !noteIds.has(id)) note.parentNode?.removeChild(note)
  }
  return Buffer.from(new XMLSerializer().serializeToString(notes), 'utf8')
}

function relationshipPartForSource(sourcePart: string): string | null {
  if (!sourcePart || sourcePart.endsWith('/')) return null
  const slash = sourcePart.lastIndexOf('/')
  const directory = slash >= 0 ? `${sourcePart.slice(0, slash + 1)}_rels/` : '_rels/'
  const fileName = slash >= 0 ? sourcePart.slice(slash + 1) : sourcePart
  return `${directory}${fileName}.rels`
}

function relationshipIdsFromEntry(entry: DocxArchiveEntry): ReadonlySet<string> {
  if (entry.isDirectory || !entry.name.endsWith('.xml')) return new Set()
  return relationshipIds(parseStrictXml(entry.contents))
}

function relationshipIds(xml: ReturnType<typeof parseStrictXml>): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const element of Array.from(xml.getElementsByTagName('*'))) {
    for (const namespace of [REL_NS, OFFICE_REL_NS]) {
      for (const attribute of ['id', 'embed', 'link']) {
        const value = element.getAttributeNS(namespace, attribute)
        if (value) ids.add(value)
      }
    }
  }
  return ids
}

function stripForbiddenElements(xml: ReturnType<typeof parseStrictXml>): void {
  const forbidden = new Set([
    'commentRangeStart',
    'commentRangeEnd',
    'commentReference',
    'customXml',
    'object',
    'oleObject',
    'altChunk',
    'subDoc'
  ])
  const all = Array.from(xml.getElementsByTagName('*'))
  for (const element of all.reverse()) {
    if (forbidden.has(element.localName ?? '')) element.parentNode?.removeChild(element)
  }
}

function resolveRelationshipTarget(sourceRelationship: string, target: string): string | null {
  const sourcePart =
    sourceRelationship === '_rels/.rels' ? '' : relationshipSourcePart(sourceRelationship)
  if (sourcePart === null) return null
  const clean = target.split(/[?#]/u, 1)[0]
  if (!clean || clean.startsWith('/') || clean.includes('\\')) return null
  const segments = posix
    .dirname(sourcePart)
    .split('/')
    .filter((segment) => Boolean(segment) && segment !== '.')
  for (const segment of clean.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
    } else segments.push(segment)
  }
  return segments.join('/')
}

function relationshipSourcePart(name: string): string | null {
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/u.exec(name)
  if (!match) return null
  return `${match[1] ?? ''}${match[2] ?? ''}`
}

function cellIsDescendant(cell: object, table: object): boolean {
  let current: object | null = cell
  while (current) {
    if (current === table) return true
    current = (current as { parentNode?: object | null }).parentNode ?? null
  }
  return false
}

function isInsideTable(element: object): boolean {
  let current = (element as { parentNode?: object | null }).parentNode ?? null
  while (current) {
    if ((current as { localName?: string | null }).localName === 'tbl') return true
    current = (current as { parentNode?: object | null }).parentNode ?? null
  }
  return false
}

function textNodes(element: {
  getElementsByTagNameNS(
    namespace: string,
    localName: string
  ): ArrayLike<{ textContent: string | null }>
}): Array<{ textContent: string | null }> {
  return Array.from(element.getElementsByTagNameNS(WORD_NS, 't'))
}

function ensureTextNodes(element: Element): Element[] {
  const existing = textNodes(element) as Element[]
  if (existing.length > 0) return existing
  const document = element.ownerDocument
  if (!document) throw new DocumentSafetyError('INVALID_DOCUMENT')
  let paragraph =
    element.localName === 'p'
      ? element
      : (Array.from(element.getElementsByTagNameNS(WORD_NS, 'p'))[0] as Element | undefined)
  if (!paragraph && element.localName === 'tc') {
    paragraph = document.createElementNS(WORD_NS, 'w:p')
    element.appendChild(paragraph)
  }
  if (!paragraph) throw new DocumentSafetyError('INVALID_DOCUMENT')
  let run = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 'r'))[0] as Element | undefined
  if (!run) {
    run = document.createElementNS(WORD_NS, 'w:r')
    paragraph.appendChild(run)
  }
  const text = document.createElementNS(WORD_NS, 'w:t')
  text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
  run.appendChild(text)
  return [text]
}

function applyFieldActionToTextNodes(
  nodes: readonly Element[],
  original: string,
  action: FieldAction
): void {
  const replacement = applyFieldAction(original, action)
  if (replacement === original) return
  let prefix = 0
  while (
    prefix < original.length &&
    prefix < replacement.length &&
    original[prefix] === replacement[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < original.length - prefix &&
    suffix < replacement.length - prefix &&
    original[original.length - suffix - 1] === replacement[replacement.length - suffix - 1]
  ) {
    suffix += 1
  }
  const changeEnd = original.length - suffix
  const inserted = replacement.slice(prefix, replacement.length - suffix)
  let offset = 0
  let insertedIntoRun = false
  for (const node of nodes) {
    const text = node.textContent ?? ''
    const start = offset
    const end = offset + text.length
    const overlapsChange = start < changeEnd && end > prefix
    const isInsertionPoint = prefix === changeEnd && prefix >= start && prefix <= end
    const before = original.slice(start, Math.min(end, prefix))
    const after = original.slice(Math.max(start, changeEnd), end)
    const insertion = !insertedIntoRun && (overlapsChange || isInsertionPoint) ? inserted : ''
    if (insertion) insertedIntoRun = true
    node.textContent = `${before}${insertion}${after}`
    offset = end
  }
  if (!insertedIntoRun && nodes[0]) {
    nodes[0].textContent = `${inserted}${nodes[0].textContent ?? ''}`
  }
}

function entry(name: string, text: string) {
  return {
    name,
    contents: Buffer.from(text, 'utf8'),
    compressionMethod: 8,
    lastModified: new Date(),
    mode: 0o600,
    isDirectory: false
  }
}

function placeholderLabel(type: FieldAction['placeholderType']): string {
  return (
    (
      {
        image: '图片',
        certificate: '证照',
        signature: '签章',
        stamp: '印章',
        text: '文字'
      } as Record<string, string>
    )[type ?? 'image'] ?? '图片'
  )
}

function escapeRegExpLiteral(character: string): string {
  return character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Regex source matching a literal (non-known) field label. NFKC-normalized,
 * regex metacharacters escaped, and arbitrary whitespace allowed between
 * characters so `注册 资本` and `注册资本` are the same slot label.
 */
export function literalLabelPattern(label: string): string {
  const characters = [...label.normalize('NFKC')].filter(
    (character) => !/[\s\u3000]/u.test(character)
  )
  return characters.map(escapeRegExpLiteral).join('[\\s\u3000]*')
}

export function replaceFieldValue(original: string, label: string, value: string): string {
  const labels: Record<string, string> = {
    bidderName: '投标人(?:名称)?|投标单位(?:名称)?|bidder\\s+name',
    unifiedSocialCreditCode: '统一社会信用代码',
    address: '地址',
    legalRepresentative: '法定代表人',
    authorizedRepresentative: '授权代表',
    contact: '联系人',
    phone: '电话|手机',
    email: '邮箱|电子邮件',
    projectName: '项目名称',
    sectionName: '标段(?:名称)?',
    compilationDate: '编制日期',
    duration: '工期|服务期|交货期|合同期限',
    qualityStandard: '质量标准|质量要求|验收标准',
    projectNumber: '项目编号|招标编号|标段编号|项目代码'
  }
  // Unknown labels belong to dynamic extra fields: match the label literally
  // so the value still lands in its own slot instead of replacing the node.
  const labelPattern = labels[label] ?? literalLabelPattern(label)
  if (!labelPattern) return value
  const match = new RegExp(`(${labelPattern})\\s*[：:]?\\s*`, 'iu').exec(original)
  if (!match || match.index === undefined) return value
  const valueStart = match.index + match[0].length
  const remainder = original.slice(valueStart)
  const separator = remainder.search(/[；;，,\n]/u)
  const nextFieldWithSpace = remainder.search(
    /\s+(?=(?:投标人(?:名称)?|投标单位(?:名称)?|bidder\s+name|统一社会信用代码|地址|法定代表人|授权代表|联系人|电话|手机|邮箱|电子邮件|项目名称|标段(?:名称)?|编制日期|工期|服务期|交货期|合同期限|质量标准|质量要求|验收标准|项目编号|招标编号|标段编号|项目代码)\s*[：:])/iu
  )
  const nextField =
    nextFieldWithSpace >= 0
      ? nextFieldWithSpace
      : remainder.search(
          /(?=(?:投标人(?:名称)?|投标单位(?:名称)?|bidder\s+name|统一社会信用代码|地址|法定代表人|授权代表|联系人|电话|手机|邮箱|电子邮件|项目名称|标段(?:名称)?|编制日期|工期|服务期|交货期|合同期限|质量标准|质量要求|验收标准|项目编号|招标编号|标段编号|项目代码)\s*[：:])/iu
        )
  const boundaries = [separator, nextField].filter((index) => index >= 0)
  const placeholder =
    /^(?:[_＿.．·…]{2,}|[-—–]{2,}|待填写|请填写|请提供|填写|空白|未填写|未提供|<[^>]+>|\[\[[^\]]+\]\]|【[^】]+】)/iu.exec(
      remainder
    )
  const boundary = boundaries.length > 0 ? Math.min(...boundaries) : -1
  const valueEnd = placeholder
    ? valueStart + placeholder[0].length
    : boundary < 0
      ? original.length
      : valueStart + boundary
  return `${original.slice(0, valueStart)}${value}${original.slice(valueEnd)}`
}

export function applyFieldAction(original: string, action: FieldAction): string {
  if (action.action === 'replace') {
    return original.trim()
      ? replaceFieldValue(original, action.label, action.value ?? '')
      : (action.value ?? '')
  }
  if (action.action === 'placeholder') {
    const replacement = `【请插入：${placeholderLabel(action.placeholderType)}】`
    const marker =
      /(?:\[\[(?:图片|证照|签章|印章|照片)[^\]]*\]\]|【请插入[：:]?(?:图片|证照|签章|印章|照片)】)/iu
    return marker.test(original) ? original.replace(marker, replacement) : replacement
  }
  return original
}

function xmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ??
      character
  )
}

import { XMLSerializer } from '@xmldom/xmldom'
import { TaskRandomMapping } from '../sanitization/randomMapping'
import { DocumentSafetyError } from '../documents/fileSafety'
import {
  readDocxArchive,
  writeDocxArchive,
  replaceArchiveEntries,
  type DocxArchive
} from '../documents/docx/archive'
import { inspectDocxArchive } from '../documents/docx/inspect'
import { parseStrictXml } from '../documents/xml'
import { sanitizeDocxMetadata } from '../documents/docx/metadata'
import type { DocumentSnapshot, FieldAction } from '../../shared/contracts'

export async function generateDocxFromTemplate(
  inputPath: string,
  outputPath: string,
  document: DocumentSnapshot,
  actions: readonly FieldAction[],
  signal?: AbortSignal
): Promise<void> {
  const archive = await readDocxArchive(inputPath, signal)
  inspectDocxArchive(archive)
  const entry = archive.entries.find((candidate) => candidate.name === 'word/document.xml')
  if (!entry) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const xml = parseStrictXml(entry.contents)
  const paragraphs = Array.from(
    xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p')
  )
  const nonEmpty = paragraphs.filter((paragraph) =>
    Array.from(
      paragraph.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        't'
      )
    ).some((node) => (node.textContent ?? '').trim())
  )
  for (const action of actions) {
    const index = Number(/^p-(\d+)$/u.exec(action.targetNodeId)?.[1] ?? -1)
    const paragraph = nonEmpty[index]
    if (!paragraph) continue
    const textNodes = Array.from(
      paragraph.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        't'
      )
    )
    if (!textNodes.length) continue
    const original = textNodes.map((node) => node.textContent ?? '').join('')
    const replacement =
      action.action === 'placeholder'
        ? `【请插入：${placeholderLabel(action.placeholderType)}】`
        : action.action === 'replace'
          ? (action.value ?? '')
          : original
    textNodes[0]!.textContent = replacement
    for (const textNode of textNodes.slice(1)) textNode.textContent = ''
  }
  const mapping = new TaskRandomMapping()
  try {
    const sanitized = sanitizeDocxMetadata(archive, mapping)
    const withDocument = replaceArchiveEntries(
      sanitized.archive,
      new Map([
        ['word/document.xml', Buffer.from(new XMLSerializer().serializeToString(xml), 'utf8')]
      ])
    )
    await writeDocxArchive(withDocument, outputPath, signal)
  } finally {
    mapping.destroy()
  }
  if (document.nodes.length === 0) throw new DocumentSafetyError('INVALID_DOCUMENT')
}

export async function generateMinimalDocxFromPdf(
  outputPath: string,
  document: DocumentSnapshot,
  actions: readonly FieldAction[],
  signal?: AbortSignal
): Promise<void> {
  const paragraphs = document.nodes
    .map((node) => {
      const action = actions.find((candidate) => candidate.targetNodeId === node.nodeId)
      const text =
        action?.action === 'replace'
          ? (action.value ?? '')
          : action?.action === 'placeholder'
            ? `【请插入：${placeholderLabel(action.placeholderType)}】`
            : node.text
      return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
    })
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`
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

function xmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ??
      character
  )
}

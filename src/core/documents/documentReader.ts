import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { Element } from '@xmldom/xmldom'
import { DocumentSafetyError } from './fileSafety'
import { readDocxArchive } from './docx/archive'
import { inspectDocxArchive } from './docx/inspect'
import { loadSafePdfFile } from './pdf/inspect'
import { parseStrictXml } from './xml'
import { makeNode, snapshot } from './documentModel'
import type { DocumentSnapshot } from '../../shared/contracts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export async function readDocumentSnapshot(
  filePath: string,
  documentType: 'docx' | 'pdf',
  signal?: AbortSignal
): Promise<DocumentSnapshot> {
  if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED')
  return documentType === 'docx'
    ? readDocxSnapshot(filePath, signal)
    : readPdfSnapshot(filePath, signal)
}

async function readDocxSnapshot(filePath: string, signal?: AbortSignal): Promise<DocumentSnapshot> {
  const archive = await readDocxArchive(filePath, signal)
  inspectDocxArchive(archive)
  const main = archive.entries.find((entry) => entry.name === 'word/document.xml')
  if (!main) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const styleLevels = readStyleOutlineLevels(
    archive.entries.find((entry) => entry.name === 'word/styles.xml')?.contents
  )
  const document = parseStrictXml(main.contents)
  const nodes: Array<ReturnType<typeof makeNode>> = []
  let paragraphIndex = 0
  let tableIndex = 0
  const body = document.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'body'
  )[0]
  if (!body) throw new DocumentSafetyError('INVALID_DOCUMENT')
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1) continue
    const element = child as typeof body
    if (element.localName === 'p') {
      appendParagraphNode(element, nodes, () => paragraphIndex++, styleLevels)
      continue
    }
    if (element.localName === 'sdt') {
      const content = element.getElementsByTagNameNS(WORD_NS, 'sdtContent')[0]
      if (content) {
        for (const contentChild of Array.from(content.childNodes)) {
          if (contentChild.nodeType !== 1) continue
          const contentElement = contentChild as Element
          if (contentElement.localName === 'p') {
            appendParagraphNode(contentElement, nodes, () => paragraphIndex++, styleLevels)
          } else if (contentElement.localName === 'tbl') {
            appendTableNodes(contentElement, nodes, tableIndex)
            tableIndex += 1
          }
        }
      }
      continue
    }
    if (element.localName !== 'tbl') continue
    appendTableNodes(element, nodes, tableIndex)
    tableIndex += 1
  }
  for (const entry of archive.entries) {
    const kind = entry.name.startsWith('word/header')
      ? 'header'
      : entry.name.startsWith('word/footer')
        ? 'footer'
        : null
    if (!kind) continue
    const text = extractWText(parseStrictXml(entry.contents))
    if (text) {
      nodes.push(
        makeNode(
          kind,
          `${kind}-${nodes.length}`,
          text,
          `${kind === 'header' ? '页眉' : '页脚'} ${nodes.length}`
        )
      )
    }
  }
  if (!nodes.length) throw new DocumentSafetyError('INVALID_DOCUMENT')
  // Demote style-derived "headings" whose text is empty or paragraph-length:
  // converted documents often tag body paragraphs with an outline level, and
  // those pseudo headings would corrupt every section boundary downstream.
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== 'heading') continue
    const length = node.text.trim().length
    if (length < 2 || length > 60) {
      nodes[index] = makeNode('paragraph', node.nodeId, node.text, node.anchor.label)
    }
  }
  // Real-world tender files often carry no heading styles at all: every
  // paragraph is manually formatted. Without any outline there is no safe
  // structural boundary for template extraction, so fall back to a strict
  // numbered/short-title heuristic.
  if (!nodes.some((node) => node.kind === 'heading')) {
    for (const [index, node] of nodes.entries()) {
      if (node.kind !== 'paragraph') continue
      const level = heuristicHeadingLevel(node.text)
      if (level === undefined) continue
      nodes[index] = makeNode('heading', node.nodeId, node.text, node.anchor.label, { level })
    }
  }
  return snapshot({
    documentType: 'docx',
    displayName: filePath.split(/[\\/]/u).pop() ?? 'document.docx',
    nodes,
    hasTextLayer: true
  })
}

/**
 * Map styleId → outline level from styles.xml. Word and WPS localise built-in
 * heading styles differently (styleId "1", "a3", …), so the level must come
 * from the style definition (w:name / w:outlineLvl), never from the styleId.
 */
function readStyleOutlineLevels(stylesContents: Buffer | undefined): ReadonlyMap<string, number> {
  const levels = new Map<string, number>()
  if (!stylesContents) return levels
  let styles: ReturnType<typeof parseStrictXml>
  try {
    styles = parseStrictXml(stylesContents)
  } catch {
    return levels
  }
  for (const style of Array.from(styles.getElementsByTagNameNS(WORD_NS, 'style'))) {
    const element = style as Element
    const styleId = element.getAttributeNS(WORD_NS, 'styleId')
    if (!styleId) continue
    const name = Array.from(element.getElementsByTagNameNS(WORD_NS, 'name'))[0] as
      Element | undefined
    const nameValue = name?.getAttributeNS(WORD_NS, 'val')?.trim() ?? ''
    const outline = Array.from(element.getElementsByTagNameNS(WORD_NS, 'outlineLvl'))[0] as
      Element | undefined
    const outlineValue = outline?.getAttributeNS(WORD_NS, 'val')
    const named = /^(?:heading|标题)\s*([1-9])$/iu.exec(nameValue)
    if (named) {
      levels.set(styleId, Math.min(9, Number(named[1])))
      continue
    }
    if (/^(?:title|标题)$/iu.test(nameValue)) {
      levels.set(styleId, 1)
      continue
    }
    if (outlineValue !== undefined && outlineValue !== null && outlineValue !== '') {
      const parsed = Number(outlineValue)
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 8) {
        levels.set(styleId, parsed + 1)
      }
    }
  }
  return levels
}

/**
 * Conservative fallback when a DOCX carries no heading styles: only short
 * lines with an explicit structural prefix or a well-known tender-section
 * suffix become pseudo headings. Depth comes from the numbering pattern.
 */
function heuristicHeadingLevel(text: string): number | undefined {
  const value = text.trim()
  if (value.length < 2 || value.length > 60) return undefined
  const numbered =
    /^(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节部分篇]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+){0,5}[、.．\s])/u.exec(
      value
    )
  if (numbered) {
    const prefix = numbered[0] ?? ''
    return Math.min(9, Math.max(1, (prefix.match(/\./gu)?.length ?? 0) + 1))
  }
  if (
    /(?:投标文件格式|资格审查|资格标|投标文件组成|附件格式|投标人须知|评标办法|合同条款|技术要求)$/u.test(
      value
    )
  ) {
    return 1
  }
  return undefined
}

function appendParagraphNode(
  paragraph: {
    getElementsByTagNameNS(
      namespace: string,
      localName: string
    ): ArrayLike<{ textContent: string | null }>
    getAttributeNS(namespace: string, localName: string): string | null
  },
  nodes: Array<ReturnType<typeof makeNode>>,
  nextIndex: () => number,
  styleLevels: ReadonlyMap<string, number>
): void {
  const text = extractWText(paragraph)
  const style = paragraph.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'pStyle'
  )[0]
  const styleName = (
    style as
      { getAttributeNS?: (namespace: string, localName: string) => string | null } | undefined
  )?.getAttributeNS?.('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
  const level = paragraphOutlineLevel(paragraph) ?? styleLevel(styleName, styleLevels)
  const index = nextIndex()
  nodes.push(
    makeNode(
      level !== undefined ? 'heading' : 'paragraph',
      `p-${index}`,
      text,
      `段落 ${index + 1}`,
      {
        ...(level !== undefined ? { level } : {})
      }
    )
  )
}

/** Direct paragraph outline level beats any style-derived level. */
function paragraphOutlineLevel(paragraph: {
  getElementsByTagNameNS(namespace: string, localName: string): ArrayLike<unknown>
}): number | undefined {
  const outline = Array.from(
    paragraph.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'outlineLvl'
    )
  )[0] as { getAttributeNS?: (namespace: string, localName: string) => string | null } | undefined
  const raw = outline?.getAttributeNS?.(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'val'
  )
  if (raw === undefined || raw === null || raw === '') return undefined
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 8 ? parsed + 1 : undefined
}

function styleLevel(
  styleId: string | null | undefined,
  styleLevels: ReadonlyMap<string, number>
): number | undefined {
  if (!styleId) return undefined
  const fromStyles = styleLevels.get(styleId)
  if (fromStyles !== undefined) return fromStyles
  // Legacy fallback for documents whose styles.xml lacks the style entry.
  const legacy = /(?:heading|title)(\d+)/iu.exec(styleId)
  return legacy ? Math.min(9, Number(legacy[1])) : undefined
}

function appendTableNodes(
  table: Element,
  nodes: Array<ReturnType<typeof makeNode>>,
  tableIndex: number
): void {
  // Keep concrete cells as the stable, ordered anchors. Emitting an aggregate
  // table node would duplicate all table text and make evidence locations ambiguous.
  const rows = Array.from(table.getElementsByTagNameNS(WORD_NS, 'tr'))
  rows.forEach((row, rowIndex) => {
    const cells = Array.from(row.getElementsByTagNameNS(WORD_NS, 'tc'))
    cells.forEach((cell, cellIndex) => {
      nodes.push(
        makeNode(
          'cell',
          `cell-${tableIndex}-${rowIndex}-${cellIndex}`,
          extractWText(cell),
          `表格 ${tableIndex + 1} 第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`
        )
      )
    })
  })
}

interface XmlTextRoot {
  getElementsByTagNameNS(
    namespace: string,
    localName: string
  ): ArrayLike<{ textContent: string | null }>
}

function extractWText(root: XmlTextRoot): string {
  return Array.from(
    root.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't')
  )
    .map((node) => node.textContent ?? '')
    .join('')
    .trim()
    .slice(0, 10_000)
}

async function readPdfSnapshot(filePath: string, signal?: AbortSignal): Promise<DocumentSnapshot> {
  const { bytes } = await loadSafePdfFile(filePath, signal)
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: true
  })
  const abortLoading = (): void => {
    void loadingTask.destroy()
  }
  signal?.addEventListener('abort', abortLoading, { once: true })
  try {
    const document = await loadingTask.promise
    const nodes: Array<ReturnType<typeof makeNode>> = []
    let totalTextLength = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED')
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false
      })
      const items = content.items.filter((item): item is TextItem => isTextItem(item))
      if (items.length === 0) continue
      const orderedItems = [...items].sort((left, right) => {
        const leftY = Number(left.transform[5] ?? 0)
        const rightY = Number(right.transform[5] ?? 0)
        if (Math.abs(leftY - rightY) > 2) return rightY - leftY
        return Number(left.transform[4] ?? 0) - Number(right.transform[4] ?? 0)
      })
      for (const [itemIndex, item] of orderedItems.entries()) {
        const text = item.str.trim().slice(0, 10_000)
        if (!text) continue
        const bbox = boundingBox([item])
        const headingLevel = pdfHeadingLevel(text, item)
        totalTextLength += text.length
        if (totalTextLength > 5_000_000) throw new DocumentSafetyError('FILE_TOO_LARGE')
        nodes.push(
          makeNode(
            headingLevel === undefined ? 'paragraph' : 'heading',
            `page-${pageNumber}-item-${itemIndex}`,
            text,
            `第 ${pageNumber} 页文本项 ${itemIndex + 1}`,
            {
              page: pageNumber,
              ...(bbox ? { bbox } : {}),
              ...(headingLevel === undefined ? {} : { level: headingLevel })
            }
          )
        )
        if (nodes.length >= 100_000) throw new DocumentSafetyError('FILE_TOO_LARGE')
      }
    }
    if (!nodes.length || totalTextLength < 8) throw new DocumentSafetyError('TEXT_LAYER_REQUIRED')
    return snapshot({
      documentType: 'pdf',
      displayName: filePath.split(/[\\/]/u).pop() ?? 'document.pdf',
      nodes,
      hasTextLayer: true
    })
  } catch (error) {
    if (error instanceof DocumentSafetyError) throw error
    if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  } finally {
    signal?.removeEventListener('abort', abortLoading)
    await loadingTask.destroy().catch(() => undefined)
  }
}

function isTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string' &&
    'transform' in item &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    'width' in item &&
    typeof item.width === 'number' &&
    'height' in item &&
    typeof item.height === 'number'
  )
}

function boundingBox(items: readonly TextItem[]): {
  x: number
  y: number
  width: number
  height: number
} | null {
  const boxes = items.map((item) => {
    const x = Number(item.transform[4] ?? 0)
    const y = Number(item.transform[5] ?? 0)
    return { left: x, bottom: y, right: x + item.width, top: y + item.height }
  })
  if (!boxes.length) return null
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.right))
  const bottom = Math.min(...boxes.map((box) => box.bottom))
  const top = Math.max(...boxes.map((box) => box.top))
  return { x: left, y: bottom, width: Math.max(0, right - left), height: Math.max(0, top - bottom) }
}

function pdfHeadingLevel(text: string, item: TextItem): number | undefined {
  if (text.length > 160) return undefined
  if (
    /^(?:qualification\s+(?:template|document\s+)?format|资格审查|投标文件格式|投标文件组成|附件格式)/iu.test(
      text
    )
  ) {
    return 1
  }
  const numbered =
    /^(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+){0,5})\s*/u.exec(
      text
    )
  if (numbered) {
    const prefix = numbered[0] ?? ''
    return Math.min(6, Math.max(1, (prefix.match(/\./gu)?.length ?? 0) + 1))
  }
  const nominalFontSize = Math.abs(Number(item.transform[0] ?? 0))
  return nominalFontSize >= 18 ? 1 : undefined
}

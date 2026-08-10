import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { DocumentSafetyError } from './fileSafety'
import { readDocxArchive } from './docx/archive'
import { inspectDocxArchive } from './docx/inspect'
import { loadSafePdfFile } from './pdf/inspect'
import { parseStrictXml } from './xml'
import { makeNode, snapshot } from './documentModel'
import type { DocumentSnapshot } from '../../shared/contracts'

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
  const document = parseStrictXml(main.contents)
  const nodes = []
  let index = 0
  for (const paragraph of Array.from(
    document.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'p'
    )
  )) {
    const text = Array.from(
      paragraph.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        't'
      )
    )
      .map((node) => node.textContent ?? '')
      .join('')
    if (!text.trim()) continue
    const style = paragraph.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'pStyle'
    )[0]
    const styleName = style?.getAttributeNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'val'
    )
    const levelMatch = /(?:heading|title)(\d+)/iu.exec(styleName ?? '')
    nodes.push(
      makeNode(levelMatch ? 'heading' : 'paragraph', `p-${index}`, text, `段落 ${index + 1}`, {
        ...(levelMatch ? { level: Number(levelMatch[1]) } : {})
      })
    )
    index += 1
  }
  for (const [tableIndex, table] of Array.from(
    document.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'tbl'
    )
  ).entries()) {
    const tableText = extractWText(table)
    if (tableText) {
      nodes.push(makeNode('table', `table-${tableIndex}`, tableText, `表格 ${tableIndex + 1}`))
    }
    const rows = Array.from(
      table.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'tr'
      )
    )
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(
        row.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'tc'
        )
      )
      cells.forEach((cell, cellIndex) => {
        const cellText = extractWText(cell)
        if (cellText) {
          nodes.push(
            makeNode(
              'cell',
              `cell-${tableIndex}-${rowIndex}-${cellIndex}`,
              cellText,
              `表格 ${tableIndex + 1} 第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`
            )
          )
        }
      })
    })
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
        makeNode(kind, `${kind}-${index}`, text, `${kind === 'header' ? '页眉' : '页脚'} ${index}`)
      )
      index += 1
    }
  }
  if (!nodes.length) throw new DocumentSafetyError('INVALID_DOCUMENT')
  return snapshot({
    documentType: 'docx',
    displayName: filePath.split(/[\\/]/u).pop() ?? 'document.docx',
    nodes,
    hasTextLayer: true
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
    const nodes = []
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
      const text = items
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 10_000)
      if (!text) continue
      const bbox = boundingBox(items)
      totalTextLength += text.length
      if (totalTextLength > 5_000_000) throw new DocumentSafetyError('FILE_TOO_LARGE')
      nodes.push(
        makeNode('paragraph', `page-${pageNumber}`, text, `第 ${pageNumber} 页文本`, {
          page: pageNumber,
          ...(bbox ? { bbox } : {})
        })
      )
      if (nodes.length >= 100_000) throw new DocumentSafetyError('FILE_TOO_LARGE')
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

import { createHash } from 'node:crypto'
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString
} from 'pdf-lib'
import type { PDFDocument, PDFObject } from 'pdf-lib'
import { DocumentSafetyError } from '../fileSafety'

const MAX_GRAPH_NODES = 250_000
const MAX_GRAPH_DEPTH = 256

export interface PdfStructuralFingerprint {
  pageCount: number
  catalogSha256: string
  pagesSha256: string
  namesSha256: string
}

export function fingerprintPdfStructure(document: PDFDocument): PdfStructuralFingerprint {
  const catalogEncoder = new PdfObjectEncoder(document)
  const catalog = catalogEncoder.encodeDictionary(
    document.catalog,
    new Set([PDFName.of('Metadata').asString()])
  )

  const pageEncoder = new PdfObjectEncoder(document)
  const pages = document.getPages().map((page) => ({
    dictionary: pageEncoder.encodeDictionary(page.node, new Set([PDFName.Parent.asString()])),
    mediaBox: pageEncoder.encode(page.node.MediaBox()),
    cropBox: pageEncoder.encode(page.node.CropBox()),
    rotate: pageEncoder.encode(page.node.Rotate()),
    resources: pageEncoder.encode(page.node.Resources())
  }))

  const namesEncoder = new PdfObjectEncoder(document)
  const names = namesEncoder.encode(document.catalog.get(PDFName.of('Names')))
  const associatedFiles = namesEncoder.encode(document.catalog.get(PDFName.of('AF')))

  return {
    pageCount: document.getPageCount(),
    catalogSha256: sha256(catalog),
    pagesSha256: sha256(JSON.stringify(pages)),
    namesSha256: sha256(JSON.stringify({ names, associatedFiles }))
  }
}

class PdfObjectEncoder {
  readonly #seen = new Map<PDFObject, number>()
  #nodes = 0

  constructor(private readonly document: PDFDocument) {}

  encode(candidate: PDFObject | undefined, depth = 0): string {
    if (!candidate) return '@missing'
    if (depth > MAX_GRAPH_DEPTH || this.#nodes++ > MAX_GRAPH_NODES) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }
    const object = candidate instanceof PDFRef ? this.document.context.lookup(candidate) : candidate
    if (!object) throw new DocumentSafetyError('INVALID_DOCUMENT')

    if (object === PDFNull) return 'null'
    if (object instanceof PDFBool) return `bool:${object.asBoolean()}`
    if (object instanceof PDFNumber) return `number:${object.asNumber()}`
    if (object instanceof PDFName) return `name:${object.asString()}`
    if (object instanceof PDFString || object instanceof PDFHexString) {
      return `text:${JSON.stringify(object.decodeText())}`
    }
    if (object instanceof PDFInvalidObject) throw new DocumentSafetyError('INVALID_DOCUMENT')

    if (object instanceof PDFStream) {
      const repeated = this.referenceFor(object)
      if (repeated) return repeated
      return `stream:${this.encodeDictionary(object.dict, new Set(['/Length']), depth + 1)}:${sha256(
        object.getContents()
      )}`
    }
    if (object instanceof PDFArray) {
      const repeated = this.referenceFor(object)
      if (repeated) return repeated
      return `array:[${object
        .asArray()
        .map((value) => this.encode(value, depth + 1))
        .join(',')}]`
    }
    if (object instanceof PDFDict) return this.encodeDictionary(object, new Set(), depth)
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }

  encodeDictionary(dict: PDFDict, excludedKeys: ReadonlySet<string>, depth = 0): string {
    if (depth > MAX_GRAPH_DEPTH || this.#nodes++ > MAX_GRAPH_NODES) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }
    const repeated = this.referenceFor(dict)
    if (repeated) return repeated
    const entries = dict
      .entries()
      .filter(([key]) => !excludedKeys.has(key.asString()))
      .sort(([left], [right]) => left.asString().localeCompare(right.asString()))
      .map(([key, value]) => `${key.asString()}:${this.encode(value, depth + 1)}`)
    return `dict:{${entries.join(',')}}`
  }

  private referenceFor(object: PDFObject): string | null {
    const existing = this.#seen.get(object)
    if (existing !== undefined) return `@${existing}`
    this.#seen.set(object, this.#seen.size)
    return null
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

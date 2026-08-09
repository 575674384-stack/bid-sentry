import { inflateSync } from 'node:zlib'
import { XMLSerializer } from '@xmldom/xmldom'
import { PDFArray, PDFDict, PDFName, PDFNull, PDFRawStream, PDFRef } from 'pdf-lib'
import type { PDFDocument, PDFObject } from 'pdf-lib'
import { DocumentSafetyError } from '../fileSafety'
import { parseStrictXml } from '../xml'
import type { MutablePdfMetadataOccurrence, ParsedPdfXmp, PdfMetadataSpec } from './metadataTypes'

const MAX_XMP_BYTES = 8 * 1024 * 1024
const DC_NS = 'http://purl.org/dc/elements/1.1/'
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const PDF_NS = 'http://ns.adobe.com/pdf/1.3/'
const XMP_NS = 'http://ns.adobe.com/xap/1.0/'
const XMP_MM_NS = 'http://ns.adobe.com/xap/1.0/mm/'

const XMP_SPECS: readonly PdfMetadataSpec[] = [
  spec(DC_NS, 'creator', 'pdf:xmp:creator', 'person-identity', 'string', 'person'),
  spec(DC_NS, 'title', 'pdf:xmp:title', 'description', 'string', 'description'),
  spec(DC_NS, 'subject', 'pdf:xmp:subject', 'description', 'string', 'description'),
  spec(DC_NS, 'description', 'pdf:xmp:description', 'description', 'string', 'description'),
  spec(PDF_NS, 'Keywords', 'pdf:xmp:Keywords', 'description', 'string', 'description'),
  spec(PDF_NS, 'Producer', 'pdf:xmp:Producer', 'application', 'string', 'application'),
  spec(PDF_NS, 'Trapped', 'pdf:xmp:Trapped', 'other', 'string', 'trapped'),
  spec(XMP_NS, 'CreatorTool', 'pdf:xmp:CreatorTool', 'application', 'string', 'application'),
  spec(
    XMP_NS,
    'CreateDate',
    'pdf:xmp:CreateDate',
    'timestamp',
    'timestamp',
    'timestamp',
    'created'
  ),
  spec(
    XMP_NS,
    'ModifyDate',
    'pdf:xmp:ModifyDate',
    'timestamp',
    'timestamp',
    'timestamp',
    'modified'
  ),
  spec(
    XMP_NS,
    'MetadataDate',
    'pdf:xmp:MetadataDate',
    'timestamp',
    'timestamp',
    'timestamp',
    'modified'
  ),
  spec(XMP_MM_NS, 'DocumentID', 'pdf:xmp:DocumentID', 'document-identifier', 'uuid', 'uuid'),
  spec(XMP_MM_NS, 'InstanceID', 'pdf:xmp:InstanceID', 'document-identifier', 'uuid', 'uuid')
]

export function parsePdfXmp(document: PDFDocument): ParsedPdfXmp | null {
  const carrier = document.catalog.get(PDFName.of('Metadata'))
  if (!carrier) return null
  const stream = document.context.lookup(carrier)
  if (!(stream instanceof PDFRawStream)) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const xml = parseStrictXml(decodeXmp(stream))
  const occurrences: MutablePdfMetadataOccurrence[] = []
  const warnings: string[] = []
  const counters = new Map<string, number>()
  const root = xml.documentElement
  if (!root) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const elements = [root, ...Array.from(xml.getElementsByTagName('*'))]

  elements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const fieldSpec = findSpec(attribute.namespaceURI, attribute.localName)
      if (fieldSpec) {
        addOccurrence(fieldSpec, attribute.value, (value) => {
          attribute.value = value
        })
      }
    })
    const fieldSpec = findSpec(element.namespaceURI, element.localName)
    if (!fieldSpec) return
    const childElements = Array.from(element.childNodes).filter((node) => node.nodeType === 1)
    if (childElements.length === 0) {
      addOccurrence(fieldSpec, element.textContent ?? '', (value) => {
        element.textContent = value
      })
      return
    }
    const listItems = Array.from(element.getElementsByTagNameNS(RDF_NS, 'li'))
    if (listItems.length === 0) {
      addOccurrence(fieldSpec, element.textContent ?? '', () => undefined, true)
      return
    }
    listItems.forEach((item) =>
      addOccurrence(fieldSpec, item.textContent ?? '', (value) => {
        item.textContent = value
      })
    )
  })

  return { carrier, stream, xml, occurrences, warnings }

  function addOccurrence(
    fieldSpec: PdfMetadataSpec,
    originalValue: string,
    setValue: (value: string) => void,
    unsupportedStructure = false
  ): void {
    const ordinal = (counters.get(fieldSpec.field) ?? 0) + 1
    counters.set(fieldSpec.field, ordinal)
    const valid = !unsupportedStructure && isValidValue(originalValue, fieldSpec)
    if (!valid) warnings.push(`${fieldSpec.field} 的值类型或结构无效，已保留原值。`)
    occurrences.push({
      locator: `xmp:${fieldSpec.field}:${ordinal}`,
      field: fieldSpec.field,
      category: fieldSpec.category,
      valueType: fieldSpec.valueType,
      action: valid ? 'randomize' : 'warn',
      replacementKind: valid ? fieldSpec.replacementKind : null,
      originalValue,
      dateRole: fieldSpec.dateRole ?? null,
      setValue
    })
  }
}

export function writePdfXmp(document: PDFDocument, parsed: ParsedPdfXmp): void {
  const bytes = Buffer.from(new XMLSerializer().serializeToString(parsed.xml), 'utf8')
  if (bytes.length > MAX_XMP_BYTES) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const dict = parsed.stream.dict.clone(document.context)
  dict.delete(PDFName.of('Filter'))
  dict.delete(PDFName.of('DecodeParms'))
  const replacement = PDFRawStream.of(dict, bytes)
  if (parsed.carrier instanceof PDFRef) document.context.assign(parsed.carrier, replacement)
  else document.catalog.set(PDFName.of('Metadata'), replacement)
}

function decodeXmp(stream: PDFRawStream): Buffer {
  if (stream.getContentsSize() > MAX_XMP_BYTES) throw new DocumentSafetyError('INVALID_DOCUMENT')
  const filter = singleFilterName(stream)
  if (!hasDefaultDecodeParameters(stream)) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  let bytes: Buffer
  if (!filter) bytes = Buffer.from(stream.getContents())
  else if (['/FlateDecode', '/Fl'].includes(filter.asString())) {
    try {
      bytes = inflateSync(stream.getContents(), { maxOutputLength: MAX_XMP_BYTES })
    } catch (error) {
      throw new DocumentSafetyError('INVALID_DOCUMENT', error)
    }
  } else throw new DocumentSafetyError('INVALID_DOCUMENT')
  if (bytes.length > MAX_XMP_BYTES) throw new DocumentSafetyError('INVALID_DOCUMENT')
  return bytes
}

function singleFilterName(stream: PDFRawStream): PDFName | null {
  const rawFilter = stream.dict.get(PDFName.of('Filter'))
  if (!rawFilter) return null
  const filter = resolveObject(stream, rawFilter)
  if (filter instanceof PDFName) return filter
  if (!(filter instanceof PDFArray) || filter.size() !== 1) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  const item = resolveObject(stream, filter.get(0))
  if (!(item instanceof PDFName)) throw new DocumentSafetyError('INVALID_DOCUMENT')
  return item
}

function hasDefaultDecodeParameters(stream: PDFRawStream): boolean {
  const rawParameters = stream.dict.get(PDFName.of('DecodeParms'))
  if (!rawParameters) return true
  const parameters = resolveObject(stream, rawParameters)
  if (isDefaultDecodeParameter(parameters)) return true
  if (!(parameters instanceof PDFArray) || parameters.size() !== 1) return false
  return isDefaultDecodeParameter(resolveObject(stream, parameters.get(0)))
}

function isDefaultDecodeParameter(value: PDFObject | undefined): boolean {
  return value === PDFNull || (value instanceof PDFDict && value.entries().length === 0)
}

function resolveObject(stream: PDFRawStream, value: PDFObject): PDFObject | undefined {
  return value instanceof PDFRef ? stream.dict.context.lookup(value) : value
}

function findSpec(namespace: string | null, localName: string | null): PdfMetadataSpec | undefined {
  return XMP_SPECS.find((field) => field.namespace === namespace && field.localName === localName)
}

function isValidValue(value: string, fieldSpec: PdfMetadataSpec): boolean {
  if (fieldSpec.valueType === 'timestamp') return Number.isFinite(Date.parse(value))
  if (fieldSpec.replacementKind === 'trapped') {
    return ['True', 'False', 'Unknown'].includes(value)
  }
  return true
}

function spec(
  namespace: string,
  localName: string,
  field: string,
  category: PdfMetadataSpec['category'],
  valueType: PdfMetadataSpec['valueType'],
  replacementKind: PdfMetadataSpec['replacementKind'],
  dateRole?: NonNullable<PdfMetadataSpec['dateRole']>
): PdfMetadataSpec {
  return {
    namespace,
    localName,
    field,
    category,
    valueType,
    replacementKind,
    ...(dateRole ? { dateRole } : {})
  }
}

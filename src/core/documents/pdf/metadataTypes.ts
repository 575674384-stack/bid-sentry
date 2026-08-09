import type { Document as XmlDocument } from '@xmldom/xmldom'
import type { PDFObject, PDFRawStream } from 'pdf-lib'
import type { MetadataFieldCategory, MetadataValueType } from '../../../shared/contracts'

export type PdfReplacementKind =
  'person' | 'application' | 'description' | 'timestamp' | 'uuid' | 'trapped' | 'trailer-id'

export type PdfDateRole = 'created' | 'modified' | null

export interface PdfMetadataOccurrence {
  locator: string
  field: string
  category: MetadataFieldCategory
  valueType: MetadataValueType
  action: 'randomize' | 'warn'
  replacementKind: PdfReplacementKind | null
  originalValue: string
  dateRole: PdfDateRole
}

export interface MutablePdfMetadataOccurrence extends PdfMetadataOccurrence {
  setValue(value: string): void
}

export interface PdfMetadataSpec {
  namespace?: string
  localName: string
  field: string
  category: MetadataFieldCategory
  valueType: MetadataValueType
  replacementKind: PdfReplacementKind
  dateRole?: Exclude<PdfDateRole, null>
}

export interface ParsedPdfXmp {
  carrier: PDFObject
  stream: PDFRawStream
  xml: XmlDocument
  occurrences: MutablePdfMetadataOccurrence[]
  warnings: string[]
}

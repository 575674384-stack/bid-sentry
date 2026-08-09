import { readFile } from 'node:fs/promises'
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString
} from 'pdf-lib'
import type { PDFObject } from 'pdf-lib'
import type { DocumentInspection } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { scanPdfMetadata } from './metadata'

const MAX_PAGE_COUNT = 2_000
const MAX_SIGNATURE_GRAPH_NODES = 250_000
const MAX_SIGNATURE_GRAPH_DEPTH = 256
const BYTE_RANGE_MARKER = Buffer.from('/ByteRange', 'ascii')

type PdfSignatureEvidence = 'field-type' | 'dictionary-type' | 'byte-range'

class PdfSignatureEvidenceError extends Error {
  constructor(readonly evidence: string) {
    super(`pdf-signature-evidence:${evidence}`)
    this.name = 'PdfSignatureEvidenceError'
  }
}

export interface PdfInspection extends DocumentInspection {
  documentType: 'pdf'
}

export interface LoadedPdf {
  bytes: Buffer
  document: PDFDocument
}

export async function loadSafePdfFile(filePath: string, signal?: AbortSignal): Promise<LoadedPdf> {
  throwIfAborted(signal)
  let bytes: Buffer
  try {
    bytes = await readFile(filePath, { signal })
  } catch (error) {
    if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  }

  try {
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true
    })
    throwIfAborted(signal)
    if (document.isEncrypted || document.context.trailerInfo.Encrypt) {
      throw new DocumentSafetyError('ENCRYPTED_FILE')
    }
    const pageCount = document.getPageCount()
    if (pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }
    const signatureEvidence = findSignatureEvidence(document, bytes.length)
    if (signatureEvidence) {
      const rawConfirmation =
        signatureEvidence === 'byte-range' && hasRawByteRange(bytes) ? ':raw-confirmed' : ''
      throw new DocumentSafetyError(
        'SIGNED_PDF',
        new PdfSignatureEvidenceError(`${signatureEvidence}${rawConfirmation}`)
      )
    }
    return { bytes, document }
  } catch (error) {
    if (error instanceof DocumentSafetyError) throw error
    if (error instanceof EncryptedPDFError || isEncryptedLoadError(error)) {
      throw new DocumentSafetyError('ENCRYPTED_FILE', error)
    }
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  }
}

export async function inspectPdfFile(
  filePath: string,
  signal?: AbortSignal
): Promise<PdfInspection> {
  const { document } = await loadSafePdfFile(filePath, signal)
  const metadata = scanPdfMetadata(document)
  return {
    documentType: 'pdf',
    fields: metadata.fields,
    warnings: metadata.warnings,
    blockers: []
  }
}

function findSignatureEvidence(
  document: PDFDocument,
  fileSize: number
): PdfSignatureEvidence | null {
  const seen = new Set<PDFObject>()
  const state = { nodes: 0 }
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    const evidence = signatureEvidenceInObject(object, document, fileSize, seen, state, 0)
    if (evidence) return evidence
  }
  return null
}

function signatureEvidenceInObject(
  candidate: PDFObject | undefined,
  document: PDFDocument,
  fileSize: number,
  seen: Set<PDFObject>,
  state: { nodes: number },
  depth: number
): PdfSignatureEvidence | null {
  if (!candidate) return null
  if (depth > MAX_SIGNATURE_GRAPH_DEPTH || state.nodes++ > MAX_SIGNATURE_GRAPH_NODES) {
    throw new DocumentSafetyError('INVALID_DOCUMENT')
  }
  const object = candidate instanceof PDFRef ? document.context.lookup(candidate) : candidate
  if (!object || seen.has(object)) return null
  seen.add(object)

  if (object instanceof PDFStream) {
    return signatureEvidenceInObject(object.dict, document, fileSize, seen, state, depth + 1)
  }
  if (object instanceof PDFArray) {
    for (const value of object.asArray()) {
      const evidence = signatureEvidenceInObject(value, document, fileSize, seen, state, depth + 1)
      if (evidence) return evidence
    }
    return null
  }
  if (!(object instanceof PDFDict)) return null

  if (isSignatureName(object, document, 'FT')) return 'field-type'
  if (isSignatureName(object, document, 'Type')) return 'dictionary-type'
  if (hasValidSignatureByteRange(object, document, fileSize)) return 'byte-range'
  for (const value of object.values()) {
    const evidence = signatureEvidenceInObject(value, document, fileSize, seen, state, depth + 1)
    if (evidence) return evidence
  }
  return null
}

function isSignatureName(dict: PDFDict, document: PDFDocument, key: string): boolean {
  const value = resolveObject(dict.get(PDFName.of(key)), document)
  return value instanceof PDFName && value.asString() === '/Sig'
}

function resolveObject(value: PDFObject | undefined, document: PDFDocument): PDFObject | undefined {
  return value instanceof PDFRef ? document.context.lookup(value) : value
}

function hasValidSignatureByteRange(
  dictionary: PDFDict,
  document: PDFDocument,
  fileSize: number
): boolean {
  const byteRange = resolveObject(dictionary.get(PDFName.of('ByteRange')), document)
  const contents = resolveObject(dictionary.get(PDFName.of('Contents')), document)
  if (
    !(byteRange instanceof PDFArray) ||
    byteRange.size() !== 4 ||
    !(contents instanceof PDFString || contents instanceof PDFHexString)
  ) {
    return false
  }
  const ranges = byteRange.asArray().map((value) => {
    const resolved = resolveObject(value, document)
    return resolved instanceof PDFNumber ? resolved.asNumber() : Number.NaN
  })
  if (ranges.some((value) => !Number.isSafeInteger(value) || value < 0)) return false
  const [firstOffset, firstLength, secondOffset, secondLength] = ranges
  if (
    firstOffset === undefined ||
    firstLength === undefined ||
    secondOffset === undefined ||
    secondLength === undefined
  ) {
    return false
  }
  return firstOffset === 0 && firstLength < secondOffset && secondOffset + secondLength <= fileSize
}

function hasRawByteRange(bytes: Buffer): boolean {
  let offset = 0
  while ((offset = bytes.indexOf(BYTE_RANGE_MARKER, offset)) >= 0) {
    const window = bytes.subarray(offset, Math.min(bytes.length, offset + 320)).toString('latin1')
    if (/^\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/u.test(window)) return true
    offset += BYTE_RANGE_MARKER.length
  }
  return false
}

function isEncryptedLoadError(error: unknown): boolean {
  return error instanceof Error && /\bencrypt(?:ed|ion)?\b/iu.test(error.message)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
}

import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom'
import type { Document as XmlDocument } from '@xmldom/xmldom'
import { DocumentSafetyError } from './fileSafety'

export function parseStrictXml(contents: Buffer): XmlDocument {
  try {
    const document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(
      contents.toString('utf8'),
      'application/xml'
    )
    if (!document.documentElement || document.getElementsByTagName('parsererror').length > 0) {
      throw new DocumentSafetyError('INVALID_DOCUMENT')
    }
    return document
  } catch (error) {
    if (error instanceof DocumentSafetyError) throw error
    throw new DocumentSafetyError('INVALID_DOCUMENT', error)
  }
}

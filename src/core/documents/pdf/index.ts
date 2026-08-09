import type { InputSnapshot } from '../../../shared/contracts'
import type { DocumentAdapter, DocumentSanitizationPlan } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { inspectPdfFile, type PdfInspection } from './inspect'
import { sanitizePdfToPath } from './sanitize'
import { verifySanitizedPdf } from './verify'

export interface PdfSanitizationPlan extends DocumentSanitizationPlan {
  documentType: 'pdf'
}

export const pdfDocumentAdapter: DocumentAdapter<PdfInspection, PdfSanitizationPlan> = {
  documentType: 'pdf',

  async inspect(input, signal) {
    assertPdfInput(input, signal)
    return inspectPdfFile(input.absolutePath, signal)
  },

  async createPlan(input, inspection, signal) {
    assertPdfInput(input, signal)
    if (inspection.documentType !== 'pdf') throw new DocumentSafetyError('INTERNAL_ERROR')
    return {
      documentType: 'pdf',
      inputSha256: input.sha256,
      fields: inspection.fields.map((field) => ({ ...field }))
    }
  },

  async sanitizeToTemp(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    await sanitizePdfToPath(input.absolutePath, temporaryPath, signal)
  },

  async verify(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    return verifySanitizedPdf(input.absolutePath, input.sha256, temporaryPath, signal)
  }
}

function assertPdfInput(input: InputSnapshot, signal: AbortSignal): void {
  if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
  if (input.documentType !== 'pdf') throw new DocumentSafetyError('UNSUPPORTED_TYPE')
}

function assertMatchingPlan(
  input: InputSnapshot,
  plan: PdfSanitizationPlan,
  signal: AbortSignal
): void {
  assertPdfInput(input, signal)
  if (plan.documentType !== 'pdf' || plan.inputSha256 !== input.sha256) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
}

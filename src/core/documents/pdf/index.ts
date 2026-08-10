import type { InputSnapshot } from '../../../shared/contracts'
import type { DocumentAdapter, DocumentSanitizationPlan } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { inspectPdfFile, loadSafePdfFile, type PdfInspection } from './inspect'
import { sanitizePdfToPath } from './sanitize'
import { verifySanitizedPdf } from './verify'
import { createPdfMetadataPlan } from './metadata'

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
    const loaded = await loadSafePdfFile(input.absolutePath, signal)
    const plan = createPdfMetadataPlan(loaded.document)
    return {
      documentType: 'pdf',
      inputSha256: input.sha256,
      fields: plan.fields.length ? plan.fields : inspection.fields.map((field) => ({ ...field })),
      previewItems: plan.items,
      replacementValues: plan.replacementValues
    }
  },

  async sanitizeToTemp(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    await sanitizePdfToPath(input.absolutePath, temporaryPath, signal, plan.replacementValues)
  },

  async verify(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    return verifySanitizedPdf(
      input.absolutePath,
      input.sha256,
      temporaryPath,
      signal,
      plan.replacementValues
    )
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

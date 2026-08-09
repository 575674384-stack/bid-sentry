import type { InputSnapshot } from '../../../shared/contracts'
import type { DocumentAdapter, DocumentSanitizationPlan } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { readDocxArchive } from './archive'
import { inspectDocxArchive, type DocxInspection } from './inspect'
import { sanitizeDocxToPath } from './sanitize'
import { verifySanitizedDocx } from './verify'

export interface DocxSanitizationPlan extends DocumentSanitizationPlan {
  documentType: 'docx'
}

export const docxDocumentAdapter: DocumentAdapter<DocxInspection, DocxSanitizationPlan> = {
  documentType: 'docx',

  async inspect(input, signal) {
    assertDocxInput(input, signal)
    return inspectDocxArchive(await readDocxArchive(input.absolutePath, signal))
  },

  async createPlan(input, inspection, signal) {
    assertDocxInput(input, signal)
    if (inspection.documentType !== 'docx') {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    return {
      documentType: 'docx',
      inputSha256: input.sha256,
      fields: inspection.fields.map((field) => ({ ...field }))
    }
  },

  async sanitizeToTemp(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    await sanitizeDocxToPath(input.absolutePath, temporaryPath, signal)
  },

  async verify(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    return verifySanitizedDocx(input.absolutePath, input.sha256, temporaryPath, signal)
  }
}

function assertDocxInput(input: InputSnapshot, signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DocumentSafetyError('TASK_CANCELLED', signal.reason)
  }
  if (input.documentType !== 'docx') {
    throw new DocumentSafetyError('UNSUPPORTED_TYPE')
  }
}

function assertMatchingPlan(
  input: InputSnapshot,
  plan: DocxSanitizationPlan,
  signal: AbortSignal
): void {
  assertDocxInput(input, signal)
  if (plan.documentType !== 'docx' || plan.inputSha256 !== input.sha256) {
    throw new DocumentSafetyError('FILE_CHANGED')
  }
}

import type { InputSnapshot } from '../../../shared/contracts'
import type { DocumentAdapter, DocumentSanitizationPlan } from '../documentAdapter'
import { DocumentSafetyError } from '../fileSafety'
import { readDocxArchive } from './archive'
import { inspectDocxArchive, type DocxInspection } from './inspect'
import { sanitizeDocxToPath } from './sanitize'
import { verifySanitizedDocx } from './verify'
import { createDocxMetadataPlan } from './metadata'

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
    const plan = createDocxMetadataPlan(await readDocxArchive(input.absolutePath, signal))
    return {
      documentType: 'docx',
      inputSha256: input.sha256,
      fields: plan.fields.length ? plan.fields : inspection.fields.map((field) => ({ ...field })),
      previewItems: plan.items,
      replacementValues: plan.replacementValues
    }
  },

  async sanitizeToTemp(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    await sanitizeDocxToPath(input.absolutePath, temporaryPath, signal, plan.replacementValues)
  },

  async verify(input, plan, temporaryPath, signal) {
    assertMatchingPlan(input, plan, signal)
    return verifySanitizedDocx(
      input.absolutePath,
      input.sha256,
      temporaryPath,
      signal,
      plan.replacementValues
    )
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

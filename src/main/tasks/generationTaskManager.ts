import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readDocumentSnapshot } from '../../core/documents/documentReader'
import { findTemplateCandidates } from '../../core/generation/templateCandidates'
import { createFillPlan } from '../../core/generation/fieldPlan'
import { generateDocxFromTemplate, generateMinimalDocxFromPdf } from '../../core/generation/docx'
import { unlink, writeFile } from 'node:fs/promises'
import { inspectDocxArchive } from '../../core/documents/docx/inspect'
import { readDocxArchive } from '../../core/documents/docx/archive'
import {
  GenerationPreviewSchema,
  GenerationResultSchema,
  type GenerationPreview,
  type GenerationPreviewRequest,
  type GenerationRequest,
  type GenerationResult,
  type InputSnapshot
} from '../../shared/contracts'
import {
  assertInputUnchanged,
  assertOutputAvailable,
  DocumentSafetyError
} from '../../core/documents/fileSafety'

export class GenerationTaskManager {
  async preview(
    request: GenerationPreviewRequest,
    input: InputSnapshot
  ): Promise<GenerationPreview> {
    await assertInputUnchanged(input)
    const document = await readDocumentSnapshot(input.absolutePath, input.documentType)
    const candidates = findTemplateCandidates(document)
    const candidate = candidates[0]
    if (!candidate) throw new DocumentSafetyError('INVALID_DOCUMENT')
    const plan = createFillPlan(document, candidate, request.userForm, input.sha256)
    return GenerationPreviewSchema.parse({
      schemaVersion: 1,
      taskId: randomUUID(),
      inputName: input.displayName,
      candidates,
      actions: plan.actions,
      warnings: plan.warnings
    })
  }

  async run(
    request: GenerationRequest,
    input: InputSnapshot,
    outputDirectory: string
  ): Promise<GenerationResult> {
    if (!request.confirmed) throw new DocumentSafetyError('INVALID_REQUEST')
    await assertInputUnchanged(input)
    const document = await readDocumentSnapshot(input.absolutePath, input.documentType)
    const candidate = findTemplateCandidates(document).find(
      (candidate) => candidate.candidateId === request.candidateId
    )
    if (!candidate) throw new DocumentSafetyError('PLAN_EXPIRED')
    const plan = createFillPlan(document, candidate, request.userForm, input.sha256)
    if (plan.unknownRequired > 0) throw new DocumentSafetyError('INVALID_REQUEST')
    const taskId = randomUUID()
    const outputName = `${input.displayName.replace(/\.(?:docx|pdf)$/iu, '')}_资格标草稿.docx`
    const outputPath = join(outputDirectory, outputName)
    await assertOutputAvailable(outputPath)
    if (input.documentType === 'docx')
      await generateDocxFromTemplate(input.absolutePath, outputPath, document, plan.actions)
    else await generateMinimalDocxFromPdf(outputPath, document, plan.actions)
    try {
      const outputArchive = await readDocxArchive(outputPath)
      inspectDocxArchive(outputArchive)
      const outputSnapshot = await readDocumentSnapshot(outputPath, 'docx')
      if (outputSnapshot.nodes.length === 0) throw new Error('empty-generation')
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      if (error instanceof DocumentSafetyError) throw error
      throw new DocumentSafetyError('INVALID_DOCUMENT', error)
    }
    const reportName = `qualification-generation-${taskId}.json`
    await writeFile(
      join(outputDirectory, reportName),
      `${JSON.stringify({ schemaVersion: 1, taskId, input: input.displayName, candidateId: candidate.candidateId, actions: plan.actions, warnings: plan.warnings }, null, 2)}\n`,
      { mode: 0o600 }
    )
    return GenerationResultSchema.parse({
      schemaVersion: 1,
      taskId,
      outputName,
      reportName,
      warnings: plan.warnings
    })
  }
}

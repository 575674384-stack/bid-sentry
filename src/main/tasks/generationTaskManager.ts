import { createHash } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { basename, join, parse as parsePath } from 'node:path'
import { readDocumentSnapshot } from '../../core/documents/documentReader'
import { findTemplateCandidates } from '../../core/generation/templateCandidates'
import { createFillPlan, isKnownTemplateLabel } from '../../core/generation/fieldPlan'
import { buildLocalGenerationExtraction } from '../../core/generation/extraction'
import {
  buildGenerationExtractionMessages,
  parseGenerationExtraction,
  type GenerationAiExtraction
} from '../../core/ai/prompts/generation'
import {
  generateDocxFromTemplate,
  generateMinimalDocxFromPdf,
  applyFieldAction,
  isForbiddenGenerationPart,
  selectedDocumentNodes
} from '../../core/generation/docx'
import { inspectDocxArchive } from '../../core/documents/docx/inspect'
import { readDocxArchive } from '../../core/documents/docx/archive'
import {
  GenerationAnalysisSchema,
  GenerationPlanSchema,
  GenerationResultSchema,
  GenerationExtractionSchema,
  type AiSettings,
  type DocumentSnapshot,
  type FieldAction,
  type FileSystemIdentity,
  type FillPlan,
  type GenerationAnalysis,
  type GenerationAnalyzeRequest,
  type GenerationExtraction,
  type GenerationPlan,
  type GenerationPlanRequest,
  type GenerationResult,
  type GenerationRunRequest,
  type InputSnapshot,
  type TemplateCandidate,
  type TemporaryWorkspaceDescriptor,
  type VerificationCheck
} from '../../shared/contracts'
import {
  assertInputUnchanged,
  DocumentSafetyError,
  withDiagnosticDocumentError
} from '../../core/documents/fileSafety'
import { requestChatCompletion } from '../ai/chatCompletionsClient'
import type { SettingsService } from '../settings/settingsService'
import { copyInputToWorkspace, publishVerifiedArtifacts } from './verifiedPublication'

const DEFAULT_ANALYSIS_TTL_MS = 30 * 60 * 1000
const MAX_ACTIVE_GENERATION_TASKS = 4
const GENERATION_TASK_TIMEOUT_MS = 30 * 60 * 1000
const MAX_OUTPUT_NAME_ATTEMPTS = 100

const NO_AI_KEY_NOTICE = '未配置 AI 接口，已使用本地规则分析。'
const AI_FALLBACK_NOTICE = 'AI 分析失败，已使用本地规则分析。'

interface StoredGenerationAnalysis {
  taskId: string
  inputId: string
  inputSha256: string
  inputDocumentType: InputSnapshot['documentType']
  document: DocumentSnapshot
  candidates: TemplateCandidate[]
  extraction: GenerationExtraction
  plans: Map<string, FillPlan>
  expiresAtMs: number
  executing: boolean
}

interface GenerationWriteValue {
  taskId: string
  outputName: string
  reportName: string
  warnings: string[]
  report: Record<string, unknown>
}

export interface GenerationTaskManagerOptions {
  now?: () => Date
  analysisTtlMs?: number
  settingsService?: SettingsService
  recordWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
  forgetWorkspace?: (workspace: TemporaryWorkspaceDescriptor) => Promise<void>
}

export class GenerationTaskManager {
  readonly #analyses = new Map<string, StoredGenerationAnalysis>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #activeRuns = new Map<string, Promise<void>>()
  readonly #now: () => Date
  readonly #analysisTtlMs: number
  readonly #settingsService: SettingsService | undefined
  readonly #recordWorkspace: GenerationTaskManagerOptions['recordWorkspace']
  readonly #forgetWorkspace: GenerationTaskManagerOptions['forgetWorkspace']
  readonly #expiryTimer: NodeJS.Timeout
  #shuttingDown = false

  constructor(options: GenerationTaskManagerOptions = {}) {
    this.#now = options.now ?? (() => new Date())
    this.#analysisTtlMs = options.analysisTtlMs ?? DEFAULT_ANALYSIS_TTL_MS
    this.#settingsService = options.settingsService
    this.#recordWorkspace = options.recordWorkspace
    this.#forgetWorkspace = options.forgetWorkspace
    this.#expiryTimer = setInterval(() => this.#evictExpiredAnalyses(), 60_000)
    this.#expiryTimer.unref?.()
  }

  async analyze(
    request: GenerationAnalyzeRequest,
    input: InputSnapshot,
    taskId: string
  ): Promise<GenerationAnalysis> {
    if (this.#shuttingDown) throw new DocumentSafetyError('TASK_CANCELLED')
    if (this.#controllers.size >= MAX_ACTIVE_GENERATION_TASKS) {
      throw new DocumentSafetyError('INVALID_REQUEST')
    }
    this.#evictExpiredAnalyses()
    if (this.#controllers.has(taskId) || this.#analyses.has(taskId)) {
      throw new DocumentSafetyError('INVALID_REQUEST')
    }
    const controller = new AbortController()
    this.#controllers.set(taskId, controller)
    let timedOut = false
    const taskTimeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GENERATION_TASK_TIMEOUT_MS)
    let resolveActive!: () => void
    const active = new Promise<void>((resolve) => {
      resolveActive = resolve
    })
    this.#activeRuns.set(taskId, active)
    try {
      await assertInputUnchanged(input, controller.signal)
      const document = await readDocumentSnapshot(
        input.absolutePath,
        input.documentType,
        controller.signal
      )
      await assertInputUnchanged(input, controller.signal)
      if (this.#shuttingDown || controller.signal.aborted)
        throw new DocumentSafetyError('TASK_CANCELLED')
      const candidates = findTemplateCandidates(document)
      if (candidates.length === 0) throw new DocumentSafetyError('INVALID_REQUEST')
      const extraction = await this.#extract(document, candidates, controller.signal)
      if (controller.signal.aborted || this.#shuttingDown) {
        throw new DocumentSafetyError('TASK_CANCELLED')
      }
      const analysis = GenerationAnalysisSchema.parse({
        schemaVersion: 1,
        taskId,
        inputName: input.displayName,
        inputSha256: input.sha256,
        candidates,
        extraction
      })
      this.#analyses.set(taskId, {
        taskId,
        inputId: request.inputId,
        inputSha256: input.sha256,
        inputDocumentType: input.documentType,
        document,
        candidates,
        extraction,
        plans: new Map(),
        expiresAtMs: this.#now().getTime() + this.#analysisTtlMs,
        executing: false
      })
      return analysis
    } catch (error) {
      if (timedOut)
        throw withDiagnosticDocumentError(new DocumentSafetyError('TASK_TIMEOUT'), 'document-parse')
      throw withDiagnosticDocumentError(error, 'document-parse')
    } finally {
      clearTimeout(taskTimeout)
      this.#activeRuns.delete(taskId)
      resolveActive()
      if (!this.#analyses.has(taskId)) this.#controllers.delete(taskId)
    }
  }

  async plan(request: GenerationPlanRequest): Promise<GenerationPlan> {
    if (this.#shuttingDown) throw new DocumentSafetyError('TASK_CANCELLED')
    this.#evictExpiredAnalyses()
    const stored = this.#analyses.get(request.analysisTaskId)
    if (!stored || stored.executing || this.#now().getTime() > stored.expiresAtMs) {
      throw new DocumentSafetyError('PLAN_EXPIRED')
    }
    const candidate = stored.candidates.find((item) => item.candidateId === request.candidateId)
    if (!candidate) throw new DocumentSafetyError('INVALID_REQUEST')
    const plan = createFillPlan(stored.document, candidate, request.userForm, stored.inputSha256)
    // A re-plan supersedes earlier plans for the same candidate: only the
    // newest confirmed form may ever reach execution.
    for (const [planId, existing] of stored.plans) {
      if (existing.candidateId === candidate.candidateId) stored.plans.delete(planId)
    }
    stored.plans.set(plan.planId, plan)
    return GenerationPlanSchema.parse({
      candidateId: plan.candidateId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      inputSha256: plan.inputSha256,
      actions: plan.actions,
      unknownRequired: plan.unknownRequired,
      unknownFields: plan.unknownFields,
      unresolvedFields: plan.unresolvedFields,
      warnings: plan.warnings
    })
  }

  async run(
    request: GenerationRunRequest,
    input: InputSnapshot,
    outputDirectory: string,
    outputDirectoryIdentity: FileSystemIdentity
  ): Promise<GenerationResult> {
    if (this.#shuttingDown) throw new DocumentSafetyError('TASK_CANCELLED')
    this.#evictExpiredAnalyses()
    const stored = this.#analyses.get(request.analysisTaskId)
    if (!stored || stored.executing) throw new DocumentSafetyError('PLAN_EXPIRED')
    if (
      this.#now().getTime() > stored.expiresAtMs ||
      stored.inputId !== request.inputId ||
      stored.inputSha256 !== input.sha256 ||
      stored.inputDocumentType !== input.documentType
    ) {
      this.#analyses.delete(request.analysisTaskId)
      throw new DocumentSafetyError('PLAN_EXPIRED')
    }
    const candidate = stored.candidates.find((item) => item.candidateId === request.candidateId)
    const plan = stored.plans.get(request.planId)
    if (
      !candidate ||
      !plan ||
      plan.candidateId !== request.candidateId ||
      plan.planDigest !== request.planDigest
    ) {
      throw new DocumentSafetyError('PLAN_EXPIRED')
    }
    if (plan.unknownRequired > 0) throw new DocumentSafetyError('INVALID_REQUEST')
    stored.executing = true
    const taskId = stored.taskId
    const controller = this.#controllers.get(taskId) ?? new AbortController()
    this.#controllers.set(taskId, controller)
    let timedOut = false
    const taskTimeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GENERATION_TASK_TIMEOUT_MS)
    let resolveActiveRun!: () => void
    const activeRun = new Promise<void>((resolve) => {
      resolveActiveRun = resolve
    })
    this.#activeRuns.set(taskId, activeRun)
    const inputBaseName = input.displayName.replace(/\.(?:docx|pdf)$/iu, '')
    // Verification must use the exact immutable copy consumed by the writer,
    // never by reopening the user-controlled path after generation.
    let frozenInputPath: string | null = null
    try {
      await assertInputUnchanged(input, controller.signal)
      const outputName = await resolveAvailableOutputName(
        outputDirectory,
        `${inputBaseName}_资格标草稿.docx`
      )
      const reportName = await resolveAvailableOutputName(
        outputDirectory,
        `qualification-generation-${taskId}.json`
      )
      const publication = await publishVerifiedArtifacts<GenerationWriteValue>({
        outputDirectory,
        outputDirectoryIdentity,
        inputs: [input],
        outputNames: [outputName, reportName],
        signal: controller.signal,
        ...(this.#recordWorkspace ? { recordWorkspace: this.#recordWorkspace } : {}),
        ...(this.#forgetWorkspace ? { forgetWorkspace: this.#forgetWorkspace } : {}),
        async write({ workspace, temporaryPaths }) {
          const frozen = await copyInputToWorkspace(workspace, input, controller.signal)
          frozenInputPath = frozen.path
          const frozenDocument = await readDocumentSnapshot(
            frozen.path,
            input.documentType,
            controller.signal
          )
          const selected = selectedDocumentNodes(frozenDocument, candidate)
          if (selected.length === 0) throw new DocumentSafetyError('PLAN_EXPIRED')
          if (input.documentType === 'docx') {
            await generateDocxFromTemplate(
              frozen.path,
              temporaryPaths[0] as string,
              frozenDocument,
              candidate,
              plan.actions,
              controller.signal
            )
          } else {
            await generateMinimalDocxFromPdf(
              temporaryPaths[0] as string,
              frozenDocument,
              candidate,
              plan.actions,
              controller.signal
            )
          }
          const report: Record<string, unknown> = {
            schemaVersion: 1,
            taskId,
            input: input.displayName,
            candidateId: candidate.candidateId,
            planDigest: plan.planDigest,
            actions: plan.actions,
            warnings: plan.warnings
          }
          await writeFile(temporaryPaths[1] as string, `${JSON.stringify(report, null, 2)}\n`, {
            mode: 0o600
          })
          return { taskId, outputName, reportName, warnings: plan.warnings, report }
        },
        verify: async ({ temporaryPaths }, value) => [
          await verifyGeneratedDocx(
            temporaryPaths[0] as string,
            stored.document,
            candidate,
            plan.actions,
            frozenInputPath,
            input.documentType
          ),
          await verifyGenerationReport(temporaryPaths[1] as string, value.report)
        ]
      })
      return GenerationResultSchema.parse({
        schemaVersion: 1,
        taskId,
        outputName: basename(publication.artifacts[0]!.outputPath),
        reportName: basename(publication.artifacts[1]!.outputPath),
        warnings: plan.warnings
      })
    } catch (error) {
      if (timedOut)
        throw withDiagnosticDocumentError(new DocumentSafetyError('TASK_TIMEOUT'), 'publish')
      throw withDiagnosticDocumentError(error, 'publish')
    } finally {
      clearTimeout(taskTimeout)
      this.#controllers.delete(taskId)
      this.#analyses.delete(request.analysisTaskId)
      this.#activeRuns.delete(taskId)
      resolveActiveRun()
    }
  }

  hasTask(taskId: string): boolean {
    this.#evictExpiredAnalyses()
    return this.#analyses.has(taskId) || this.#controllers.has(taskId)
  }

  cancel(taskId: string): void {
    this.#evictExpiredAnalyses()
    this.#controllers.get(taskId)?.abort()
    this.#analyses.delete(taskId)
    if (!this.#activeRuns.has(taskId)) this.#controllers.delete(taskId)
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true
    for (const controller of this.#controllers.values()) controller.abort()
    await Promise.allSettled([...this.#activeRuns.values()])
    this.#controllers.clear()
    this.#analyses.clear()
    clearInterval(this.#expiryTimer)
    this.#activeRuns.clear()
  }

  async #extract(
    document: DocumentSnapshot,
    candidates: readonly TemplateCandidate[],
    signal: AbortSignal
  ): Promise<GenerationExtraction> {
    const settings = this.#settingsService ? await this.#settingsService.getPublicSettings() : null
    const apiKey = this.#settingsService ? await this.#settingsService.getApiKeyForUse() : null
    if (settings && apiKey) {
      const ai = await this.#requestAiExtraction(document, candidates, settings, apiKey, signal)
      if (ai) {
        return GenerationExtractionSchema.parse({
          aiUsed: true,
          qualificationSummary: ai.qualificationSummary,
          suggestedFields: ai.suggestedFields.filter((field) => !isKnownTemplateLabel(field.label)),
          notices: []
        })
      }
      if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED')
      // The AI step is an enhancement, never a hard dependency: fall back to
      // the deterministic local extraction and tell the user what happened.
      const local = buildLocalGenerationExtraction(document, candidates)
      return GenerationExtractionSchema.parse({
        aiUsed: false,
        ...local,
        notices: [AI_FALLBACK_NOTICE]
      })
    }
    const local = buildLocalGenerationExtraction(document, candidates)
    return GenerationExtractionSchema.parse({
      aiUsed: false,
      ...local,
      notices: [NO_AI_KEY_NOTICE]
    })
  }

  async #requestAiExtraction(
    document: DocumentSnapshot,
    candidates: readonly TemplateCandidate[],
    settings: AiSettings,
    apiKey: string,
    signal: AbortSignal
  ): Promise<GenerationAiExtraction | null> {
    const sections = candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      title: candidate.title,
      text: selectedDocumentNodes(document, candidate)
        .map((node) => node.text)
        .filter((text) => text.trim().length > 0)
        .join('\n')
    }))
    const [system, user] = buildGenerationExtractionMessages(sections)
    if (!system || !user) throw new DocumentSafetyError('INTERNAL_ERROR')
    let content: string
    try {
      content = await requestChatCompletion({
        baseUrl: settings.baseUrl,
        apiKey,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        signal,
        messages: [system, user]
      })
    } catch (error) {
      if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
      return null
    }
    const parsed = parseGenerationExtraction(content)
    if (parsed) return parsed
    try {
      const corrected = await requestChatCompletion({
        baseUrl: settings.baseUrl,
        apiKey,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        signal,
        messages: [
          system,
          {
            role: 'user',
            content: `${user.content}\n上一次输出无法通过 JSON Schema 校验。只返回一个修正后的 JSON 对象，不要解释。`
          }
        ]
      })
      return parseGenerationExtraction(corrected)
    } catch (error) {
      if (signal.aborted) throw new DocumentSafetyError('TASK_CANCELLED', error)
      return null
    }
  }

  #evictExpiredAnalyses(): void {
    const now = this.#now().getTime()
    for (const [taskId, analysis] of this.#analyses) {
      if (analysis.expiresAtMs <= now && !analysis.executing) {
        this.#analyses.delete(taskId)
        this.#controllers.delete(taskId)
      }
    }
  }
}

/**
 * Pick a collision-free output name inside the input's own directory, adding
 * ` (2)`, ` (3)`, … when a previous draft already exists. Publication still
 * re-checks availability atomically; this only chooses the candidate name.
 */
async function resolveAvailableOutputName(
  outputDirectory: string,
  fileName: string
): Promise<string> {
  const parts = parsePath(fileName)
  for (let attempt = 1; attempt <= MAX_OUTPUT_NAME_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? fileName : `${parts.name} (${attempt})${parts.ext}`
    try {
      await lstat(join(outputDirectory, candidate))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new DocumentSafetyError('OUTPUT_EXISTS')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function verifyGeneratedDocx(
  outputPath: string,
  source: DocumentSnapshot,
  candidate: TemplateCandidate,
  actions: readonly FieldAction[],
  sourcePath: string | null,
  sourceType: InputSnapshot['documentType']
): Promise<readonly VerificationCheck[]> {
  const archive = await readDocxArchive(outputPath)
  inspectDocxArchive(archive)
  if (sourceType === 'docx') {
    if (!sourcePath) throw new DocumentSafetyError('INTERNAL_ERROR')
    const sourceArchive = await readDocxArchive(sourcePath)
    const sourceEntries = new Map(sourceArchive.entries.map((entry) => [entry.name, entry]))
    if (archive.entries.some((entry) => isForbiddenGenerationPart(entry.name))) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    if (archive.entries.some((entry) => !entry.isDirectory && !sourceEntries.has(entry.name))) {
      throw new DocumentSafetyError('INTERNAL_ERROR')
    }
    for (const entry of archive.entries) {
      if (!isStableTemplatePart(entry.name)) continue
      const sourceEntry = sourceEntries.get(entry.name)
      if (!sourceEntry || !buffersEqual(sourceEntry.contents, entry.contents)) {
        throw new DocumentSafetyError('INTERNAL_ERROR')
      }
    }
  }
  const output = await readDocumentSnapshot(outputPath, 'docx')
  if (output.nodes.length === 0) throw new DocumentSafetyError('INTERNAL_ERROR')
  const selected = selectedDocumentNodes(source, candidate)
  if (selected.length === 0) throw new DocumentSafetyError('INTERNAL_ERROR')
  const expectedTexts = selected.map((node) =>
    actions
      .filter((action) => action.targetNodeId === node.nodeId)
      .reduce((text, action) => applyExpectedAction(text, action), node.text)
  )
  const outputBodyNodes = output.nodes.filter(
    (node) => node.kind !== 'header' && node.kind !== 'footer'
  )
  // Cropping is an isolation boundary, not a best-effort filter. Extra body
  // nodes would mean content outside the confirmed template was published.
  if (outputBodyNodes.length !== expectedTexts.length) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  for (const [index, expected] of expectedTexts.entries()) {
    if (outputBodyNodes[index]?.text !== expected) throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  const outputText = outputBodyNodes.map((node) => node.text).join('\n')
  const sourceOutsideRange = source.nodes
    .filter((node) => !selected.some((selectedNode) => selectedNode.nodeId === node.nodeId))
    .filter((node) => node.kind !== 'header' && node.kind !== 'footer')
    .map((node) => node.text)
    .filter((text) => text.trim().length >= 8)
  if (sourceOutsideRange.some((text) => outputText.includes(text))) {
    throw new DocumentSafetyError('INTERNAL_ERROR')
  }
  return [
    passedCheck('docx-archive-valid', '生成 DOCX 压缩包结构通过验证。'),
    passedCheck('template-range-isolated', '生成 DOCX 未包含确认范围之外的正文。'),
    passedCheck('field-actions-applied', '生成 DOCX 中的确认填充动作已生效。'),
    passedCheck('template-text-fidelity', '生成 DOCX 的选中范围文本与批准填充计划逐节点一致。'),
    passedCheck(
      'template-dependencies-preserved',
      '生成 DOCX 的样式、媒体、页眉页脚等稳定依赖保持不变。'
    )
  ]
}

function isStableTemplatePart(name: string): boolean {
  return /^word\/(?:styles\.xml|numbering\.xml|settings\.xml|fontTable\.xml|webSettings\.xml|theme\/|header[^/]*\.xml|footer[^/]*\.xml|media\/)/iu.test(
    name
  )
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  return (
    createHash('sha256').update(left).digest('hex') ===
    createHash('sha256').update(right).digest('hex')
  )
}

function applyExpectedAction(text: string, action: FieldAction): string {
  return applyFieldAction(text, action)
}

async function verifyGenerationReport(
  path: string,
  expected: Record<string, unknown>
): Promise<readonly VerificationCheck[]> {
  const source = await readFile(path, 'utf8')
  const parsed = JSON.parse(source) as unknown
  if (JSON.stringify(parsed) !== JSON.stringify(expected))
    throw new DocumentSafetyError('INTERNAL_ERROR')
  return [passedCheck('generation-report-valid', '资格标制作报告通过内容一致性验证。')]
}

function passedCheck(name: string, message: string): VerificationCheck {
  return { name, status: 'passed', message }
}

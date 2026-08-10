import {
  AiConnectionTestResultSchema,
  AiSettingsSchema,
  IpcResponseEnvelopeSchema,
  SanitizationPreviewSchema,
  SanitizationTaskResultSchema,
  ResultShownSchema,
  SelectedInputFilesSchema,
  SelectedOutputDirectorySchema,
  TaskCancellationResultSchema,
  TaskProgressSchema,
  type AiConnectionTestResult,
  type AiSettings,
  type AiSettingsUpdate,
  type AppError,
  type SanitizationCommand,
  type SanitizationPreview,
  type SanitizationTaskResult,
  type SelectedInputFiles,
  type SelectedOutputDirectory,
  type TaskProgress,
  UpdateStatusSchema,
  UpdateActionResultSchema,
  type UpdateStatus,
  TaskStartResultSchema,
  type TaskStartResult,
  ReviewResultSchema,
  type ReviewRequest,
  type ReviewResult,
  GenerationPreviewSchema,
  GenerationResultSchema,
  type GenerationPreviewRequest,
  type GenerationRequest,
  type GenerationPreview,
  type GenerationResult
} from '../../../shared/contracts'

interface RendererBridge {
  readonly apiVersion: 1
  getSettings(): Promise<unknown>
  saveSettings(update: AiSettingsUpdate): Promise<unknown>
  testAiConnection(update: AiSettingsUpdate): Promise<unknown>
  selectInputFiles(): Promise<unknown>
  selectOutputDirectory(): Promise<unknown>
  previewSanitization(inputIds: readonly string[]): Promise<unknown>
  executeSanitization(command: SanitizationCommand): Promise<unknown>
  cancelTask(taskId: string): Promise<unknown>
  showResultInFolder(fileId: string): Promise<unknown>
  onTaskProgress(listener: (progress: unknown) => void): () => void
  getUpdateStatus(): Promise<unknown>
  checkUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  installUpdate(): Promise<unknown>
  openReleasePage(): Promise<unknown>
  openDiagnosticsDirectory(): Promise<unknown>
  startReview(): Promise<unknown>
  runReview(request: ReviewRequest): Promise<unknown>
  cancelReview(taskId: string): Promise<unknown>
  previewGeneration(request: GenerationPreviewRequest): Promise<unknown>
  runGeneration(request: GenerationRequest): Promise<unknown>
  cancelGeneration(taskId: string): Promise<unknown>
}

type RuntimeSchema<T> = { parse(value: unknown): T }

export class BidSentryApiError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
    this.name = 'BidSentryApiError'
  }
}

export const bidSentryApi = Object.freeze({
  getSettings(): Promise<AiSettings> {
    return invoke(() => bridge().getSettings(), AiSettingsSchema)
  },
  saveSettings(update: AiSettingsUpdate): Promise<AiSettings> {
    return invoke(() => bridge().saveSettings(update), AiSettingsSchema)
  },
  testAiConnection(update: AiSettingsUpdate): Promise<AiConnectionTestResult> {
    return invoke(() => bridge().testAiConnection(update), AiConnectionTestResultSchema)
  },
  selectInputFiles(): Promise<SelectedInputFiles> {
    return invoke(() => bridge().selectInputFiles(), SelectedInputFilesSchema)
  },
  selectOutputDirectory(): Promise<SelectedOutputDirectory | null> {
    return invoke(() => bridge().selectOutputDirectory(), SelectedOutputDirectorySchema.nullable())
  },
  previewSanitization(inputIds: readonly string[]): Promise<SanitizationPreview> {
    return invoke(() => bridge().previewSanitization(inputIds), SanitizationPreviewSchema)
  },
  executeSanitization(command: SanitizationCommand): Promise<SanitizationTaskResult> {
    return invoke(() => bridge().executeSanitization(command), SanitizationTaskResultSchema)
  },
  cancelTask(taskId: string): Promise<void> {
    return invoke(() => bridge().cancelTask(taskId), TaskCancellationResultSchema).then(
      () => undefined
    )
  },
  showResultInFolder(fileId: string): Promise<void> {
    return invoke(() => bridge().showResultInFolder(fileId), ResultShownSchema).then(
      () => undefined
    )
  },
  onTaskProgress(listener: (progress: TaskProgress) => void): () => void {
    return bridge().onTaskProgress((rawProgress) => listener(TaskProgressSchema.parse(rawProgress)))
  },
  getUpdateStatus(): Promise<UpdateStatus> {
    return invoke(() => bridge().getUpdateStatus(), UpdateStatusSchema)
  },
  checkUpdates(): Promise<UpdateStatus> {
    return invoke(() => bridge().checkUpdates(), UpdateStatusSchema)
  },
  downloadUpdate(): Promise<UpdateStatus> {
    return invoke(() => bridge().downloadUpdate(), UpdateStatusSchema)
  },
  installUpdate(): Promise<UpdateStatus> {
    return invoke(() => bridge().installUpdate(), UpdateStatusSchema)
  },
  openReleasePage(): Promise<void> {
    return invoke(() => bridge().openReleasePage(), UpdateActionResultSchema).then(() => undefined)
  },
  openDiagnosticsDirectory(): Promise<void> {
    return invoke(() => bridge().openDiagnosticsDirectory(), ResultShownSchema).then(
      () => undefined
    )
  },
  startReview(): Promise<TaskStartResult> {
    return invoke(() => bridge().startReview(), TaskStartResultSchema)
  },
  runReview(request: ReviewRequest): Promise<ReviewResult> {
    return invoke(() => bridge().runReview(request), ReviewResultSchema)
  },
  cancelReview(taskId: string): Promise<void> {
    return invoke(() => bridge().cancelReview(taskId), TaskCancellationResultSchema).then(
      () => undefined
    )
  },
  previewGeneration(request: GenerationPreviewRequest): Promise<GenerationPreview> {
    return invoke(() => bridge().previewGeneration(request), GenerationPreviewSchema)
  },
  runGeneration(request: GenerationRequest): Promise<GenerationResult> {
    return invoke(() => bridge().runGeneration(request), GenerationResultSchema)
  },
  cancelGeneration(taskId: string): Promise<void> {
    return invoke(() => bridge().cancelGeneration(taskId), TaskCancellationResultSchema).then(
      () => undefined
    )
  }
})

async function invoke<T>(operation: () => Promise<unknown>, schema: RuntimeSchema<T>): Promise<T> {
  const response = IpcResponseEnvelopeSchema.parse(await operation())
  if (!response.ok) throw new BidSentryApiError(response.error)
  return schema.parse(response.data)
}

function bridge(): RendererBridge {
  const candidate = (window as unknown as { bidSentry?: RendererBridge }).bidSentry
  if (!candidate || candidate.apiVersion !== 1) {
    throw new Error('Bid Sentry desktop bridge is unavailable.')
  }
  return candidate
}

export function userMessage(error: unknown): string {
  return error instanceof BidSentryApiError
    ? error.appError.message
    : '操作未能完成，请重试；若问题持续，请重新启动应用。'
}

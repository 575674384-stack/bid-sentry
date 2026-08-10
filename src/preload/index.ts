import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_RESPONSE_DATA_SCHEMAS,
  IpcRequestEnvelopeSchema,
  IpcResponseEnvelopeSchema,
  MAX_IPC_EVENT_BYTES,
  MAX_IPC_REQUEST_BYTES,
  MAX_IPC_RESPONSE_BYTES,
  TaskProgressSchema,
  type AiSettingsUpdate,
  type IpcResponseEnvelope,
  type SanitizationCommand,
  type TaskProgress,
  type ReviewRequest,
  type GenerationAnalyzeRequest,
  type GenerationPlanRequest,
  type GenerationRunRequest
} from '../shared/contracts'

export interface BidSentryApi {
  readonly apiVersion: 1
  getSettings(): Promise<IpcResponseEnvelope>
  saveSettings(update: AiSettingsUpdate): Promise<IpcResponseEnvelope>
  testAiConnection(update: AiSettingsUpdate): Promise<IpcResponseEnvelope>
  selectInputFiles(): Promise<IpcResponseEnvelope>
  previewSanitization(inputIds: readonly string[]): Promise<IpcResponseEnvelope>
  executeSanitization(command: SanitizationCommand): Promise<IpcResponseEnvelope>
  cancelTask(taskId: string): Promise<IpcResponseEnvelope>
  showResultInFolder(fileId: string): Promise<IpcResponseEnvelope>
  onTaskProgress(listener: (progress: TaskProgress) => void): () => void
  getUpdateStatus(): Promise<IpcResponseEnvelope>
  checkUpdates(): Promise<IpcResponseEnvelope>
  downloadUpdate(): Promise<IpcResponseEnvelope>
  installUpdate(): Promise<IpcResponseEnvelope>
  openReleasePage(): Promise<IpcResponseEnvelope>
  openDiagnosticsDirectory(): Promise<IpcResponseEnvelope>
  startReview(): Promise<IpcResponseEnvelope>
  runReview(request: ReviewRequest): Promise<IpcResponseEnvelope>
  cancelReview(taskId: string): Promise<IpcResponseEnvelope>
  analyzeGeneration(request: GenerationAnalyzeRequest): Promise<IpcResponseEnvelope>
  planGeneration(request: GenerationPlanRequest): Promise<IpcResponseEnvelope>
  runGeneration(request: GenerationRunRequest): Promise<IpcResponseEnvelope>
  cancelGeneration(taskId: string): Promise<IpcResponseEnvelope>
}

const api: BidSentryApi = {
  apiVersion: 1,
  getSettings: () => invoke(IPC_CHANNELS.settingsGet, {}, IPC_RESPONSE_DATA_SCHEMAS.settingsGet),
  saveSettings: (update) =>
    invoke(IPC_CHANNELS.settingsSave, update, IPC_RESPONSE_DATA_SCHEMAS.settingsSave),
  testAiConnection: (settings) =>
    invoke(IPC_CHANNELS.settingsTestAi, { settings }, IPC_RESPONSE_DATA_SCHEMAS.settingsTestAi),
  selectInputFiles: () =>
    invoke(IPC_CHANNELS.filesSelectInputs, {}, IPC_RESPONSE_DATA_SCHEMAS.filesSelectInputs),
  previewSanitization: (inputIds) =>
    invoke(
      IPC_CHANNELS.sanitizePreview,
      { inputIds: [...inputIds] },
      IPC_RESPONSE_DATA_SCHEMAS.sanitizePreview
    ),
  executeSanitization: (command) =>
    invoke(IPC_CHANNELS.sanitizeExecute, command, IPC_RESPONSE_DATA_SCHEMAS.sanitizeExecute),
  cancelTask: (taskId) =>
    invoke(IPC_CHANNELS.taskCancel, { taskId }, IPC_RESPONSE_DATA_SCHEMAS.taskCancel),
  showResultInFolder: (fileId) =>
    invoke(IPC_CHANNELS.filesOpenResult, { fileId }, IPC_RESPONSE_DATA_SCHEMAS.filesOpenResult),
  onTaskProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, rawProgress: unknown): void => {
      if (serializedSize(rawProgress) > MAX_IPC_EVENT_BYTES) return
      const progress = TaskProgressSchema.safeParse(rawProgress)
      if (progress.success) listener(progress.data)
    }
    ipcRenderer.on(IPC_CHANNELS.taskSubscribe, handler)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      ipcRenderer.removeListener(IPC_CHANNELS.taskSubscribe, handler)
    }
  },
  getUpdateStatus: () => invoke(IPC_CHANNELS.updatesGet, {}, IPC_RESPONSE_DATA_SCHEMAS.updatesGet),
  checkUpdates: () =>
    invoke(IPC_CHANNELS.updatesCheck, { schemaVersion: 1 }, IPC_RESPONSE_DATA_SCHEMAS.updatesCheck),
  downloadUpdate: () =>
    invoke(
      IPC_CHANNELS.updatesDownload,
      { schemaVersion: 1, acknowledged: true },
      IPC_RESPONSE_DATA_SCHEMAS.updatesDownload
    ),
  installUpdate: () =>
    invoke(
      IPC_CHANNELS.updatesInstall,
      { schemaVersion: 1, acknowledged: true },
      IPC_RESPONSE_DATA_SCHEMAS.updatesInstall
    ),
  openReleasePage: () =>
    invoke(IPC_CHANNELS.updatesOpenRelease, {}, IPC_RESPONSE_DATA_SCHEMAS.updatesOpenRelease),
  openDiagnosticsDirectory: () =>
    invoke(IPC_CHANNELS.diagnosticsOpen, {}, IPC_RESPONSE_DATA_SCHEMAS.diagnosticsOpen),
  startReview: () => invoke(IPC_CHANNELS.reviewStart, {}, IPC_RESPONSE_DATA_SCHEMAS.reviewStart),
  runReview: (request) =>
    invoke(IPC_CHANNELS.reviewRun, request, IPC_RESPONSE_DATA_SCHEMAS.reviewRun),
  cancelReview: (taskId) =>
    invoke(IPC_CHANNELS.reviewCancel, { taskId }, IPC_RESPONSE_DATA_SCHEMAS.reviewCancel),
  analyzeGeneration: (request) =>
    invoke(IPC_CHANNELS.generationAnalyze, request, IPC_RESPONSE_DATA_SCHEMAS.generationAnalyze),
  planGeneration: (request) =>
    invoke(IPC_CHANNELS.generationPlan, request, IPC_RESPONSE_DATA_SCHEMAS.generationPlan),
  runGeneration: (request) =>
    invoke(IPC_CHANNELS.generationRun, request, IPC_RESPONSE_DATA_SCHEMAS.generationRun),
  cancelGeneration: (taskId) =>
    invoke(IPC_CHANNELS.generationCancel, { taskId }, IPC_RESPONSE_DATA_SCHEMAS.generationCancel)
}
Object.freeze(api)

async function invoke(
  channel: string,
  payload: unknown,
  responseSchema: { parse(value: unknown): unknown }
): Promise<IpcResponseEnvelope> {
  const request = IpcRequestEnvelopeSchema.parse({
    schemaVersion: 1,
    requestId: globalThis.crypto.randomUUID(),
    payload
  })
  if (serializedSize(request) > MAX_IPC_REQUEST_BYTES) throw new Error('IPC request is too large.')
  const rawResponse = await ipcRenderer.invoke(channel, request)
  if (serializedSize(rawResponse) > MAX_IPC_RESPONSE_BYTES) {
    throw new Error('IPC response is too large.')
  }
  const response = IpcResponseEnvelopeSchema.parse(rawResponse)
  if (!response.ok) return response
  return IpcResponseEnvelopeSchema.parse({ ...response, data: responseSchema.parse(response.data) })
}

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

contextBridge.exposeInMainWorld('bidSentry', api)

declare global {
  interface Window {
    bidSentry: BidSentryApi
  }
}

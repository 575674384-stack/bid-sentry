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
  type TaskProgress
} from '../shared/contracts'

export interface BidSentryApi {
  readonly apiVersion: 1
  getSettings(): Promise<IpcResponseEnvelope>
  saveSettings(update: AiSettingsUpdate): Promise<IpcResponseEnvelope>
  testAiConnection(update: AiSettingsUpdate): Promise<IpcResponseEnvelope>
  selectInputFiles(): Promise<IpcResponseEnvelope>
  selectOutputDirectory(): Promise<IpcResponseEnvelope>
  previewSanitization(inputIds: readonly string[]): Promise<IpcResponseEnvelope>
  executeSanitization(command: SanitizationCommand): Promise<IpcResponseEnvelope>
  cancelTask(taskId: string): Promise<IpcResponseEnvelope>
  showResultInFolder(fileId: string): Promise<IpcResponseEnvelope>
  onTaskProgress(listener: (progress: TaskProgress) => void): () => void
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
  selectOutputDirectory: () =>
    invoke(IPC_CHANNELS.filesSelectOutput, {}, IPC_RESPONSE_DATA_SCHEMAS.filesSelectOutput),
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
  }
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

import type {
  AppError,
  SanitizationPreview,
  SanitizationTaskResult,
  SelectedInputFile,
  TaskProgress
} from '../../../../shared/contracts'

export type SanitizerStage =
  | 'idle'
  | 'selecting'
  | 'previewing'
  | 'awaiting-confirmation'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface SanitizerState {
  stage: SanitizerStage
  files: SelectedInputFile[]
  preview: SanitizationPreview | null
  result: SanitizationTaskResult | null
  progress: number
  progressMessage: string
  acknowledged: boolean
  cancelling: boolean
  errorMessage: string | null
  diagnosticError?: AppError
}

export type SanitizerAction =
  | { type: 'selection-started' }
  | { type: 'selection-cancelled' }
  | { type: 'files-selected'; files: SelectedInputFile[] }
  | { type: 'file-removed'; inputId: string }
  | { type: 'preview-started' }
  | { type: 'preview-succeeded'; preview: SanitizationPreview }
  | { type: 'acknowledgement-changed'; acknowledged: boolean }
  | { type: 'execution-started' }
  | { type: 'progress-received'; progress: TaskProgress }
  | { type: 'cancellation-requested' }
  | { type: 'execution-succeeded'; result: SanitizationTaskResult }
  | { type: 'operation-failed'; message: string; error?: AppError }
  | { type: 'operation-notice'; message: string }
  | { type: 'reset' }

export const initialSanitizerState: SanitizerState = {
  stage: 'idle',
  files: [],
  preview: null,
  result: null,
  progress: 0,
  progressMessage: '请选择需要清洗的文件。',
  acknowledged: false,
  cancelling: false,
  errorMessage: null
}

const BUSY_STAGES: readonly SanitizerStage[] = ['previewing', 'running', 'verifying']
const TASK_ACTIVE_STAGES: readonly SanitizerStage[] = [
  'previewing',
  'awaiting-confirmation',
  'running',
  'verifying'
]

export function sanitizerReducer(state: SanitizerState, action: SanitizerAction): SanitizerState {
  switch (action.type) {
    case 'selection-started':
      if (state.stage !== 'idle') return state
      return { ...state, stage: 'selecting', errorMessage: null }
    case 'selection-cancelled':
      if (state.stage !== 'selecting') return state
      return {
        ...state,
        stage: 'idle',
        errorMessage: null
      }
    case 'files-selected':
      if (state.stage !== 'selecting' || action.files.length === 0) return state
      return {
        ...initialSanitizerState,
        files: [...action.files],
        progressMessage: '文件已就绪，可以生成安全预览。'
      }
    case 'file-removed': {
      if (state.stage !== 'idle') return state
      const files = state.files.filter((file) => file.inputId !== action.inputId)
      if (files.length === state.files.length) return state
      if (files.length === 0) return initialSanitizerState
      return { ...state, files, errorMessage: null }
    }
    case 'preview-started':
      if (state.files.length === 0 || state.stage !== 'idle') return state
      return {
        ...state,
        stage: 'previewing',
        preview: null,
        result: null,
        acknowledged: false,
        progress: 0.05,
        progressMessage: '正在检查文件结构与元数据。',
        errorMessage: null
      }
    case 'preview-succeeded':
      if (state.stage !== 'previewing') return state
      if (!matchesSelection(state, action.preview)) {
        return {
          ...state,
          stage: 'failed',
          progress: 0,
          progressMessage: '任务未完成。',
          errorMessage: '预览与当前文件不一致，请重新选择文件。'
        }
      }
      return {
        ...state,
        stage: 'awaiting-confirmation',
        preview: action.preview,
        progress: 0,
        progressMessage: '预览已生成，请逐项核对后明确确认。'
      }
    case 'acknowledgement-changed':
      if (state.stage !== 'awaiting-confirmation') return state
      return { ...state, acknowledged: action.acknowledged }
    case 'execution-started':
      if (
        state.stage !== 'awaiting-confirmation' ||
        !state.acknowledged ||
        hasBlockers(state.preview)
      ) {
        return state
      }
      return {
        ...state,
        stage: 'running',
        progress: 0.05,
        progressMessage: '任务已确认，正在准备安全工作区。',
        cancelling: false,
        errorMessage: null
      }
    case 'progress-received':
      if (
        !state.preview ||
        action.progress.taskId !== state.preview.taskId ||
        !['awaiting-confirmation', 'running', 'verifying'].includes(state.stage) ||
        (state.stage === 'awaiting-confirmation' && !state.cancelling)
      ) {
        return state
      }
      if (action.progress.state === 'running' || action.progress.state === 'verifying') {
        return {
          ...state,
          stage: action.progress.state,
          progress: action.progress.progress,
          progressMessage: action.progress.message
        }
      }
      if (action.progress.state === 'cancelled') {
        return {
          ...state,
          stage: 'cancelled',
          preview: null,
          progress: 0,
          progressMessage: action.progress.message,
          cancelling: false
        }
      }
      if (action.progress.state === 'failed') {
        return {
          ...state,
          stage: 'failed',
          preview: null,
          progress: 0,
          progressMessage: action.progress.message,
          cancelling: false,
          errorMessage: action.progress.error?.message ?? action.progress.message,
          ...(action.progress.error ? { diagnosticError: action.progress.error } : {})
        }
      }
      if (state.stage === 'awaiting-confirmation') return state
      // completed is buffered until the separately validated result response arrives.
      if (
        action.progress.state === 'completed' &&
        action.progress.verification?.status === 'passed'
      ) {
        return {
          ...state,
          stage: 'verifying',
          progress: 0.99,
          progressMessage: '验证通过，正在确认结果文件。'
        }
      }
      return state
    case 'cancellation-requested':
      if (
        state.stage !== 'awaiting-confirmation' &&
        state.stage !== 'running' &&
        state.stage !== 'verifying'
      ) {
        return state
      }
      return { ...state, cancelling: true, progressMessage: '正在安全取消并清理临时文件。' }
    case 'execution-succeeded':
      if (
        (state.stage !== 'running' && state.stage !== 'verifying') ||
        !state.preview ||
        action.result.taskId !== state.preview.taskId ||
        action.result.report.files.some((file) => file.verification.status !== 'passed')
      ) {
        return state
      }
      return {
        ...state,
        stage: 'completed',
        preview: null,
        result: action.result,
        progress: 1,
        progressMessage: '全部文件已清洗并通过内容验证。',
        cancelling: false,
        errorMessage: null
      }
    case 'operation-failed':
      return {
        ...state,
        stage: 'failed',
        preview: null,
        progress: 0,
        progressMessage: '任务未完成。',
        cancelling: false,
        errorMessage: action.message,
        ...(action.error ? { diagnosticError: action.error } : {})
      }
    case 'operation-notice':
      return {
        ...state,
        cancelling: false,
        errorMessage: action.message
      }
    case 'reset':
      if (TASK_ACTIVE_STAGES.includes(state.stage)) return state
      return initialSanitizerState
  }
}

export function hasBlockers(preview: SanitizationPreview | null): boolean {
  return !preview || preview.files.some((file) => file.blockers.length > 0)
}

export function isBusyStage(stage: SanitizerStage): boolean {
  return BUSY_STAGES.includes(stage)
}

function matchesSelection(state: SanitizerState, preview: SanitizationPreview): boolean {
  if (preview.files.length !== state.files.length) return false
  const selectedIds = new Set(state.files.map((file) => file.inputId))
  const previewIds = new Set(preview.files.map((file) => file.inputId))
  return (
    previewIds.size === preview.files.length &&
    preview.files.every((file) => selectedIds.has(file.inputId))
  )
}

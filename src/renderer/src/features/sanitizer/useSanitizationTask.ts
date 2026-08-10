import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { BidSentryApiError, bidSentryApi, userMessage } from '../../api/bidSentryApi'
import {
  hasBlockers,
  initialSanitizerState,
  sanitizerReducer,
  type SanitizerState
} from './sanitizerState'

export interface SanitizationTaskController {
  state: SanitizerState
  canPreview: boolean
  canExecute: boolean
  selectFiles(): Promise<void>
  removeFile(inputId: string): void
  createPreview(): Promise<void>
  setAcknowledged(acknowledged: boolean): void
  execute(): Promise<void>
  cancel(): Promise<void>
  reset(): void
  showResult(fileId: string): Promise<void>
}

export function useSanitizationTask(): SanitizationTaskController {
  const [state, dispatch] = useReducer(sanitizerReducer, initialSanitizerState)

  useEffect(
    () =>
      bidSentryApi.onTaskProgress((progress) => {
        dispatch({ type: 'progress-received', progress })
      }),
    []
  )

  const selectFiles = useCallback(async () => {
    if (state.stage !== 'idle') return
    dispatch({ type: 'selection-started' })
    try {
      const selection = await bidSentryApi.selectInputFiles()
      dispatch(
        selection.files.length
          ? { type: 'files-selected', files: selection.files }
          : { type: 'selection-cancelled' }
      )
    } catch (error) {
      dispatch({
        type: 'operation-failed',
        message: userMessage(error),
        ...(error instanceof BidSentryApiError ? { error: error.appError } : {})
      })
    }
  }, [state.stage])

  const removeFile = useCallback((inputId: string) => {
    dispatch({ type: 'file-removed', inputId })
  }, [])

  const createPreview = useCallback(async () => {
    if (state.stage !== 'idle' || state.files.length === 0) return
    dispatch({ type: 'preview-started' })
    try {
      const preview = await bidSentryApi.previewSanitization(
        state.files.map((file) => file.inputId)
      )
      dispatch({ type: 'preview-succeeded', preview })
    } catch (error) {
      dispatch({
        type: 'operation-failed',
        message: userMessage(error),
        ...(error instanceof BidSentryApiError ? { error: error.appError } : {})
      })
    }
  }, [state.files, state.stage])

  const setAcknowledged = useCallback((acknowledged: boolean) => {
    dispatch({ type: 'acknowledgement-changed', acknowledged })
  }, [])

  const execute = useCallback(async () => {
    const { preview, acknowledged } = state
    if (
      state.stage !== 'awaiting-confirmation' ||
      state.cancelling ||
      !preview ||
      !acknowledged ||
      hasBlockers(preview)
    ) {
      return
    }
    dispatch({ type: 'execution-started' })
    try {
      const result = await bidSentryApi.executeSanitization({
        schemaVersion: 1,
        taskId: preview.taskId,
        planDigest: preview.planDigest,
        acknowledged: true
      })
      dispatch({ type: 'execution-succeeded', result })
    } catch (error) {
      if (error instanceof BidSentryApiError && error.appError.code === 'TASK_CANCELLED') {
        dispatch({
          type: 'progress-received',
          progress: {
            schemaVersion: 1,
            taskId: preview.taskId,
            state: 'cancelled',
            progress: 0,
            message: error.appError.message
          }
        })
      } else {
        dispatch({
          type: 'operation-failed',
          message: userMessage(error),
          ...(error instanceof BidSentryApiError ? { error: error.appError } : {})
        })
      }
    }
  }, [state])

  const cancel = useCallback(async () => {
    if (
      !state.preview ||
      !['awaiting-confirmation', 'running', 'verifying'].includes(state.stage)
    ) {
      return
    }
    dispatch({ type: 'cancellation-requested' })
    try {
      await bidSentryApi.cancelTask(state.preview.taskId)
    } catch (error) {
      dispatch({ type: 'operation-notice', message: userMessage(error) })
    }
  }, [state.preview, state.stage])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  const showResult = useCallback(async (fileId: string) => {
    try {
      await bidSentryApi.showResultInFolder(fileId)
    } catch (error) {
      dispatch({ type: 'operation-notice', message: userMessage(error) })
    }
  }, [])

  const canPreview = state.files.length > 0 && state.stage === 'idle'
  const canExecute =
    state.stage === 'awaiting-confirmation' &&
    state.acknowledged &&
    !state.cancelling &&
    !hasBlockers(state.preview)

  return useMemo(
    () => ({
      state,
      canPreview,
      canExecute,
      selectFiles,
      removeFile,
      createPreview,
      setAcknowledged,
      execute,
      cancel,
      reset,
      showResult
    }),
    [
      state,
      canPreview,
      canExecute,
      selectFiles,
      removeFile,
      createPreview,
      setAcknowledged,
      execute,
      cancel,
      reset,
      showResult
    ]
  )
}

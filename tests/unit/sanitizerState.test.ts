import { describe, expect, it } from 'vitest'
import {
  SanitizationPreviewSchema,
  SanitizationTaskResultSchema,
  type SanitizationPreview,
  type SanitizationTaskResult,
  type SelectedInputFile,
  type TaskProgress
} from '../../src/shared/contracts'
import {
  initialSanitizerState,
  sanitizerReducer,
  type SanitizerState
} from '../../src/renderer/src/features/sanitizer/sanitizerState'

const TASK_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_TASK_ID = '10000000-0000-4000-8000-000000000002'
const INPUT_ID = '20000000-0000-4000-8000-000000000001'
const OTHER_INPUT_ID = '20000000-0000-4000-8000-000000000002'
const INPUT: SelectedInputFile = {
  inputId: INPUT_ID,
  displayName: '资格审查.docx',
  documentType: 'docx',
  size: 2048
}

describe('sanitizerReducer', () => {
  it('enters selection only while idle and never abandons an active preview', () => {
    const selecting = sanitizerReducer(initialSanitizerState, { type: 'selection-started' })
    expect(selecting.stage).toBe('selecting')
    expect(sanitizerReducer(selecting, { type: 'selection-cancelled' }).stage).toBe('idle')

    const awaiting = awaitingState()
    expect(sanitizerReducer(awaiting, { type: 'selection-started' })).toBe(awaiting)

    const running = runningState()
    expect(sanitizerReducer(running, { type: 'selection-started' })).toBe(running)
  })

  it('accepts non-empty files only while selecting', () => {
    const selecting = sanitizerReducer(selectedState(), { type: 'selection-started' })
    const nextFile = { ...INPUT, inputId: OTHER_INPUT_ID, displayName: '技术标.pdf' }
    const selected = sanitizerReducer(selecting, {
      type: 'files-selected',
      files: [nextFile]
    })

    expect(selected.stage).toBe('idle')
    expect(selected.files).toEqual([nextFile])
    expect(selected.preview).toBeNull()
    expect(sanitizerReducer(selected, { type: 'files-selected', files: [INPUT] })).toBe(selected)
    expect(sanitizerReducer(selecting, { type: 'files-selected', files: [] })).toBe(selecting)
  })

  it('starts preview only from idle with selected files', () => {
    expect(sanitizerReducer(initialSanitizerState, { type: 'preview-started' })).toBe(
      initialSanitizerState
    )

    const awaiting = { ...awaitingState(), acknowledged: true }
    expect(sanitizerReducer(awaiting, { type: 'preview-started' })).toBe(awaiting)

    expect(sanitizerReducer(selectedState(), { type: 'preview-started' })).toMatchObject({
      stage: 'previewing',
      preview: null,
      result: null,
      acknowledged: false,
      errorMessage: null
    })
  })

  it('accepts a preview only when every input matches the current selection', () => {
    const previewing = previewingState()
    const accepted = sanitizerReducer(previewing, {
      type: 'preview-succeeded',
      preview: preview()
    })
    expect(accepted.stage).toBe('awaiting-confirmation')

    const mismatched = sanitizerReducer(previewing, {
      type: 'preview-succeeded',
      preview: preview({ inputId: OTHER_INPUT_ID })
    })
    expect(mismatched).toMatchObject({
      stage: 'failed',
      preview: null,
      errorMessage: '预览与当前文件不一致，请重新选择文件。'
    })

    const idle = selectedState()
    expect(sanitizerReducer(idle, { type: 'preview-succeeded', preview: preview() })).toBe(idle)
  })

  it('rejects a preview that duplicates one selected input and omits another', () => {
    const otherInput: SelectedInputFile = {
      ...INPUT,
      inputId: OTHER_INPUT_ID,
      displayName: '技术标.pdf',
      documentType: 'pdf'
    }
    const selecting = sanitizerReducer(initialSanitizerState, { type: 'selection-started' })
    const selected = sanitizerReducer(selecting, {
      type: 'files-selected',
      files: [INPUT, otherInput]
    })
    const previewing = sanitizerReducer(selected, { type: 'preview-started' })
    const basePreview = preview()
    const duplicatePreview = SanitizationPreviewSchema.parse({
      ...basePreview,
      files: [basePreview.files[0], basePreview.files[0]]
    })

    expect(
      sanitizerReducer(previewing, {
        type: 'preview-succeeded',
        preview: duplicatePreview
      })
    ).toMatchObject({
      stage: 'failed',
      errorMessage: '预览与当前文件不一致，请重新选择文件。'
    })
  })

  it('changes acknowledgement only while awaiting confirmation', () => {
    const awaiting = awaitingState()
    expect(
      sanitizerReducer(awaiting, {
        type: 'acknowledgement-changed',
        acknowledged: true
      }).acknowledged
    ).toBe(true)
    expect(
      sanitizerReducer(selectedState(), {
        type: 'acknowledgement-changed',
        acknowledged: true
      }).acknowledged
    ).toBe(false)
  })

  it('requires acknowledgement and a blocker-free preview to execute', () => {
    const awaiting = awaitingState()
    expect(sanitizerReducer(awaiting, { type: 'execution-started' })).toBe(awaiting)

    const acknowledged = { ...awaiting, acknowledged: true }
    expect(sanitizerReducer(acknowledged, { type: 'execution-started' })).toMatchObject({
      stage: 'running',
      progress: 0.05,
      cancelling: false
    })

    const blocked = {
      ...awaiting,
      acknowledged: true,
      preview: preview({ blocked: true })
    }
    expect(sanitizerReducer(blocked, { type: 'execution-started' })).toBe(blocked)
  })

  it('accepts progress only for the active task and maps running/verifying stages', () => {
    const running = runningState()
    const wrongTask = progress('verifying', 0.6, OTHER_TASK_ID)
    expect(sanitizerReducer(running, { type: 'progress-received', progress: wrongTask })).toBe(
      running
    )

    const verifying = sanitizerReducer(running, {
      type: 'progress-received',
      progress: progress('verifying', 0.65)
    })
    expect(verifying).toMatchObject({
      stage: 'verifying',
      progress: 0.65,
      progressMessage: '正在验证'
    })

    const beforeExecution = awaitingState()
    expect(
      sanitizerReducer(beforeExecution, {
        type: 'progress-received',
        progress: progress('running', 0.25)
      })
    ).toBe(beforeExecution)
  })

  it('never treats an unverified completed event as UI completion', () => {
    const running = runningState()
    const invalidCompleted = {
      schemaVersion: 1,
      taskId: TASK_ID,
      state: 'completed',
      progress: 1,
      message: '完成但没有验证'
    } as TaskProgress
    expect(
      sanitizerReducer(running, {
        type: 'progress-received',
        progress: invalidCompleted
      })
    ).toBe(running)

    const attested = sanitizerReducer(running, {
      type: 'progress-received',
      progress: completedProgress()
    })
    expect(attested).toMatchObject({
      stage: 'verifying',
      progress: 0.99,
      result: null
    })
  })

  it('maps cancellation and failure events to safe terminal states', () => {
    const running = runningState()
    const cancelled = sanitizerReducer(running, {
      type: 'progress-received',
      progress: progress('cancelled', 0)
    })
    expect(cancelled).toMatchObject({
      stage: 'cancelled',
      progress: 0,
      cancelling: false
    })

    const failed = sanitizerReducer(running, {
      type: 'progress-received',
      progress: {
        ...progress('failed', 0),
        error: {
          schemaVersion: 1,
          code: 'INVALID_DOCUMENT',
          message: '文件结构无效或已损坏。',
          retryable: false
        }
      }
    })
    expect(failed).toMatchObject({
      stage: 'failed',
      errorMessage: '文件结构无效或已损坏。'
    })
  })

  it('marks cancellation pending for a preview or active execution', () => {
    const awaiting = awaitingState()
    const abandoning = sanitizerReducer(awaiting, { type: 'cancellation-requested' })
    expect(abandoning).toMatchObject({
      stage: 'awaiting-confirmation',
      cancelling: true
    })
    expect(
      sanitizerReducer(abandoning, {
        type: 'progress-received',
        progress: progress('cancelled', 0)
      })
    ).toMatchObject({
      stage: 'cancelled',
      cancelling: false
    })

    const running = runningState()
    expect(sanitizerReducer(running, { type: 'cancellation-requested' })).toMatchObject({
      stage: 'running',
      cancelling: true
    })
    const idle = selectedState()
    expect(sanitizerReducer(idle, { type: 'cancellation-requested' })).toBe(idle)
  })

  it('requires a current task and passed file verification before showing a result', () => {
    const running = runningState()
    const validResult = taskResult()
    const completed = sanitizerReducer(running, {
      type: 'execution-succeeded',
      result: validResult
    })
    expect(completed).toMatchObject({
      stage: 'completed',
      progress: 1,
      result: validResult
    })

    const staleResult = { ...validResult, taskId: OTHER_TASK_ID } as SanitizationTaskResult
    expect(sanitizerReducer(running, { type: 'execution-succeeded', result: staleResult })).toBe(
      running
    )

    const unverifiedResult = {
      ...validResult,
      report: {
        ...validResult.report,
        files: validResult.report.files.map((file) => ({
          ...file,
          verification: { ...file.verification, status: 'failed' as const }
        }))
      }
    } as SanitizationTaskResult
    expect(
      sanitizerReducer(running, {
        type: 'execution-succeeded',
        result: unverifiedResult
      })
    ).toBe(running)
  })

  it('ignores late progress after a validated result is shown', () => {
    const completed = sanitizerReducer(runningState(), {
      type: 'execution-succeeded',
      result: taskResult()
    })
    expect(
      sanitizerReducer(completed, {
        type: 'progress-received',
        progress: progress('cancelled', 0)
      })
    ).toBe(completed)
  })

  it('keeps nonfatal notices in place and uses failures only for terminal operations', () => {
    const completed = sanitizerReducer(runningState(), {
      type: 'execution-succeeded',
      result: taskResult()
    })
    expect(
      sanitizerReducer(completed, { type: 'operation-notice', message: '无法打开文件夹。' })
    ).toMatchObject({
      stage: 'completed',
      errorMessage: '无法打开文件夹。'
    })

    expect(
      sanitizerReducer(selectedState(), { type: 'operation-failed', message: '预览失败。' })
    ).toMatchObject({
      stage: 'failed',
      errorMessage: '预览失败。'
    })
  })

  it('resets terminal states but refuses to reset active work', () => {
    const failed = sanitizerReducer(selectedState(), {
      type: 'operation-failed',
      message: '失败。'
    })
    expect(sanitizerReducer(failed, { type: 'reset' })).toEqual(initialSanitizerState)

    const running = runningState()
    expect(sanitizerReducer(running, { type: 'reset' })).toBe(running)
    const awaiting = awaitingState()
    expect(sanitizerReducer(awaiting, { type: 'reset' })).toBe(awaiting)
  })
})

function selectedState(): SanitizerState {
  const selecting = sanitizerReducer(initialSanitizerState, { type: 'selection-started' })
  return sanitizerReducer(selecting, { type: 'files-selected', files: [INPUT] })
}

function previewingState(): SanitizerState {
  return sanitizerReducer(selectedState(), { type: 'preview-started' })
}

function awaitingState(): SanitizerState {
  return sanitizerReducer(previewingState(), {
    type: 'preview-succeeded',
    preview: preview()
  })
}

function runningState(): SanitizerState {
  const ready = {
    ...awaitingState(),
    acknowledged: true
  }
  return sanitizerReducer(ready, { type: 'execution-started' })
}

function preview(options: { inputId?: string; blocked?: boolean } = {}): SanitizationPreview {
  return SanitizationPreviewSchema.parse({
    schemaVersion: 1,
    taskId: TASK_ID,
    planDigest: 'a'.repeat(64),
    createdAt: '2026-08-09T12:00:00.000Z',
    files: [
      {
        inputId: options.inputId ?? INPUT_ID,
        displayName: INPUT.displayName,
        documentType: INPUT.documentType,
        size: INPUT.size,
        fields: [
          {
            field: 'dc:creator',
            category: 'person-identity',
            valueType: 'string',
            occurrences: 1,
            action: 'randomize'
          }
        ],
        warnings: [],
        blockers: options.blocked
          ? [
              {
                schemaVersion: 1,
                code: 'SIGNED_DOCUMENT',
                message: '检测到文档数字签名，为避免签名失效已停止处理。',
                retryable: false
              }
            ]
          : []
      }
    ]
  })
}

function progress(state: TaskProgress['state'], value: number, taskId = TASK_ID): TaskProgress {
  return {
    schemaVersion: 1,
    taskId,
    state,
    progress: value,
    message: state === 'verifying' ? '正在验证' : `任务状态：${state}`,
    ...(state === 'failed'
      ? {
          error: {
            schemaVersion: 1 as const,
            code: 'INTERNAL_ERROR' as const,
            message: '发生内部错误，任务已安全停止。',
            retryable: false
          }
        }
      : {})
  }
}

function completedProgress(): TaskProgress {
  return {
    ...progress('completed', 1),
    verification: verification()
  }
}

function verification() {
  return {
    schemaVersion: 1 as const,
    status: 'passed' as const,
    checks: [{ name: '内容指纹', status: 'passed' as const, message: '内容保持不变。' }],
    inputSha256: 'b'.repeat(64),
    outputSha256: 'c'.repeat(64)
  }
}

function taskResult(): SanitizationTaskResult {
  return SanitizationTaskResultSchema.parse({
    schemaVersion: 1,
    taskId: TASK_ID,
    report: {
      schemaVersion: 1,
      appVersion: '0.1.0',
      taskId: TASK_ID,
      startedAt: '2026-08-09T12:00:00.000Z',
      completedAt: '2026-08-09T12:00:01.000Z',
      status: 'completed',
      files: [
        {
          input: {
            displayName: INPUT.displayName,
            documentType: 'docx',
            size: INPUT.size,
            sha256: 'b'.repeat(64)
          },
          output: {
            displayName: '资格审查_sanitized.docx',
            documentType: 'docx',
            size: 2200,
            sha256: 'c'.repeat(64)
          },
          outputDisplayName: '资格审查_sanitized.docx',
          fields: [
            {
              field: 'dc:creator',
              category: 'person-identity',
              occurrences: 1,
              status: 'changed'
            }
          ],
          warnings: [],
          verification: verification()
        }
      ],
      warnings: []
    },
    files: [
      {
        fileId: '40000000-0000-4000-8000-000000000001',
        displayName: '资格审查_sanitized.docx',
        kind: 'sanitized-document'
      },
      {
        fileId: '40000000-0000-4000-8000-000000000002',
        displayName: 'bid-sentry-report.json',
        kind: 'json-report'
      },
      {
        fileId: '40000000-0000-4000-8000-000000000003',
        displayName: 'bid-sentry-report.html',
        kind: 'html-report'
      }
    ]
  })
}

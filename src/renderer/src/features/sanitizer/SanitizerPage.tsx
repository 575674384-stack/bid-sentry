import { useEffect, useState } from 'react'
import type { AiSettings, AppError } from '../../../../shared/contracts'
import { bidSentryApi } from '../../api/bidSentryApi'
import { Notice, Stepper } from '../../components/ui'
import { FileSelection } from './FileSelection'
import { PreviewPanel } from './PreviewPanel'
import { ResultPanel } from './ResultPanel'
import { TaskProgress } from './TaskProgress'
import { useSanitizationTask } from './useSanitizationTask'

const STEPS = [
  { key: 'select', label: '选择文件' },
  { key: 'preview', label: '安全预览' },
  { key: 'execute', label: '执行清洗' },
  { key: 'result', label: '清洗结果' }
] as const

const STEP_INDEX: Readonly<Record<string, number>> = {
  idle: 0,
  selecting: 0,
  previewing: 1,
  'awaiting-confirmation': 1,
  running: 2,
  verifying: 2
}

export function SanitizerPage({ active }: { active: boolean }): React.JSX.Element {
  const controller = useSanitizationTask()
  const { state } = controller
  const [settings, setSettings] = useState<AiSettings | null>(null)

  useEffect(() => {
    if (!active) return
    let current = true
    bidSentryApi
      .getSettings()
      .then((value) => {
        if (current) setSettings(value)
      })
      .catch(() => {
        if (current) setSettings(null)
      })
    return () => {
      current = false
    }
  }, [active])

  const outputInfo = outputInfoText(settings)

  if (state.stage === 'completed' && state.result) {
    return (
      <div className="card-stack" data-testid="sanitizer-page">
        {state.errorMessage ? <Notice tone="warning">{state.errorMessage}</Notice> : null}
        <ResultPanel
          result={state.result}
          onShowFile={(fileId) => void controller.showResult(fileId)}
          onReset={controller.reset}
        />
      </div>
    )
  }

  if (state.stage === 'failed' || state.stage === 'cancelled') {
    const cancelled = state.stage === 'cancelled'
    return (
      <div className="card-stack" data-testid="sanitizer-page">
        <section className="card terminal-card">
          <span
            className={`terminal-icon ${cancelled ? 'is-neutral' : 'is-danger'}`}
            aria-hidden="true"
          >
            {cancelled ? '■' : '!'}
          </span>
          <h2 className="terminal-title">{cancelled ? '任务已取消' : '任务已安全停止'}</h2>
          <p className="terminal-desc">
            {cancelled
              ? '没有生成或替换任何文件，原文件保持不变。'
              : (state.errorMessage ?? state.progressMessage)}
          </p>
          {!cancelled && state.diagnosticError ? (
            <DiagnosticDetails error={state.diagnosticError} />
          ) : null}
          <Notice tone="info" title="原文件保持不变">
            临时文件已清理；重新开始会创建全新的预览和确认流程。
          </Notice>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              type="button"
              data-testid="sanitizer-reset"
              onClick={controller.reset}
            >
              返回并重新选择
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="card-stack" data-testid="sanitizer-page">
      <Stepper steps={STEPS} current={STEP_INDEX[state.stage] ?? 0} />

      {state.errorMessage ? (
        <Notice tone="danger" title="操作未完成">
          {state.errorMessage}
        </Notice>
      ) : null}

      {state.stage === 'idle' || state.stage === 'selecting' ? (
        <>
          <FileSelection
            files={state.files}
            selecting={state.stage === 'selecting'}
            disabled={state.stage !== 'idle'}
            outputInfo={outputInfo}
            onSelect={() => void controller.selectFiles()}
            onRemove={controller.removeFile}
          />
          {state.files.length > 0 ? (
            <div className="btn-row is-between">
              <span className="btn-note">下一步：生成安全预览，不会修改任何文件。</span>
              <button
                className="btn btn-primary"
                type="button"
                data-testid="sanitizer-preview"
                disabled={!controller.canPreview}
                onClick={() => void controller.createPreview()}
              >
                生成安全预览
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {state.stage === 'previewing' ? (
        <section className="card" aria-live="polite">
          <p className="loading-line">
            <span className="spinner" aria-hidden="true" />
            正在检查文件结构并读取元数据…
          </p>
        </section>
      ) : null}

      {state.stage === 'awaiting-confirmation' && state.preview ? (
        <>
          <PreviewPanel
            preview={state.preview}
            acknowledged={state.acknowledged}
            outputInfo={outputInfo}
            onAcknowledgedChange={controller.setAcknowledged}
          />
          <div className="btn-row is-between">
            <span className="btn-note">确认后才会写入新副本；验证失败不会发布结果。</span>
            <div className="btn-row">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={state.cancelling}
                onClick={() => void controller.cancel()}
              >
                {state.cancelling ? '正在放弃…' : '放弃预览'}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                data-testid="sanitizer-execute"
                disabled={!controller.canExecute}
                onClick={() => void controller.execute()}
              >
                确认并开始清洗
              </button>
            </div>
          </div>
        </>
      ) : null}

      {state.stage === 'running' || state.stage === 'verifying' ? (
        <TaskProgress
          stage={state.stage}
          progress={state.progress}
          message={state.progressMessage}
          cancelling={state.cancelling}
          onCancel={() => void controller.cancel()}
        />
      ) : null}
    </div>
  )
}

function outputInfoText(settings: AiSettings | null): string | null {
  if (!settings) return null
  if (settings.outputMode === 'overwrite') {
    return '输出位置：验证通过后直接替换原文件（可在设置中修改）'
  }
  return `输出位置：与原文件同目录 · 文件名加后缀「${settings.outputSuffix}」（可在设置中修改）`
}

function DiagnosticDetails({ error }: { error: AppError }): React.JSX.Element {
  const summary = [
    `Bid Sentry ${error.code}`,
    `阶段: ${error.stage ?? 'unknown'}`,
    `诊断编号: ${error.detailId ?? '未生成'}`
  ].join('\n')
  return (
    <div className="btn-row">
      <span className="muted text-sm">
        错误码：{error.code} · 阶段：{error.stage ?? 'unknown'}
        {error.detailId ? ` · 诊断编号：${error.detailId}` : ''}
      </span>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => void navigator.clipboard?.writeText(summary)}
      >
        复制诊断摘要
      </button>
    </div>
  )
}

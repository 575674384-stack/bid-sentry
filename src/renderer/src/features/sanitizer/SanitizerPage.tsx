import { FileSelection } from './FileSelection'
import { PreviewPanel } from './PreviewPanel'
import { ResultPanel } from './ResultPanel'
import { TaskProgress } from './TaskProgress'
import { useSanitizationTask } from './useSanitizationTask'

const OUTPUT_BUSY_STAGES = ['selecting', 'previewing', 'running', 'verifying'] as const

export function SanitizerPage(): React.JSX.Element {
  const controller = useSanitizationTask()
  const { state } = controller
  const outputBusy = OUTPUT_BUSY_STAGES.some((stage) => stage === state.stage)

  if (state.stage === 'completed' && state.result) {
    return (
      <div className="page-stack">
        {state.errorMessage ? <InlineError message={state.errorMessage} /> : null}
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
      <section className="panel terminal-panel" aria-labelledby="terminal-title">
        <div className={`terminal-mark ${cancelled ? 'neutral' : 'danger'}`} aria-hidden="true">
          {cancelled ? '■' : '!'}
        </div>
        <p className="step-label">{cancelled ? '任务已取消' : '任务已安全停止'}</p>
        <h2 id="terminal-title">{cancelled ? '没有生成最终文件' : '未发布任何未验证结果'}</h2>
        <p>{state.errorMessage ?? state.progressMessage}</p>
        <div className="safety-note compact">
          <strong>原文件保持不变</strong>
          <span>临时文件已由任务流程清理；重新开始会创建全新的预览和确认。</span>
        </div>
        <button className="button primary" type="button" onClick={controller.reset}>
          返回文件选择
        </button>
      </section>
    )
  }

  return (
    <div className="page-stack">
      {state.errorMessage ? <InlineError message={state.errorMessage} /> : null}

      <FileSelection
        files={state.files}
        outputDirectory={state.outputDirectory}
        filesDisabled={state.stage !== 'idle'}
        outputDisabled={outputBusy}
        selecting={state.stage === 'selecting'}
        onSelectFiles={() => void controller.selectFiles()}
        onSelectOutput={() => void controller.selectOutputDirectory()}
      />

      {(state.stage === 'idle' || state.stage === 'selecting') && state.files.length > 0 ? (
        <div className="flow-action">
          <div>
            <strong>下一步：安全预览</strong>
            <span>先检查结构、签名和将要重置的字段，不会修改文件。</span>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={!controller.canPreview}
            onClick={() => void controller.createPreview()}
          >
            生成清洗预览
          </button>
        </div>
      ) : null}

      {state.stage === 'previewing' ? (
        <section className="panel inspection-panel" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <p className="step-label">正在检查</p>
            <h2>读取安全结构与元数据类别</h2>
            <p>{state.progressMessage}</p>
          </div>
        </section>
      ) : null}

      {state.stage === 'awaiting-confirmation' && state.preview ? (
        <>
          <PreviewPanel
            preview={state.preview}
            acknowledged={state.acknowledged}
            outputReady={Boolean(state.outputDirectory)}
            onAcknowledgedChange={controller.setAcknowledged}
          />
          <div className="flow-action confirm-action">
            <div>
              <strong>确认后才会写入新副本</strong>
              <span>任务完成必须同时满足内容验证和结果文件核验。</span>
            </div>
            <div className="button-group">
              <button
                className="button secondary"
                type="button"
                disabled={state.cancelling}
                onClick={() => void controller.cancel()}
              >
                {state.cancelling ? '正在放弃…' : '放弃本次预览'}
              </button>
              <button
                className="button primary"
                type="button"
                disabled={!controller.canExecute}
                onClick={() => void controller.execute()}
              >
                开始安全清洗
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

function InlineError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="notice danger page-notice" role="alert">
      <strong>操作提示</strong>
      <span>{message}</span>
    </div>
  )
}

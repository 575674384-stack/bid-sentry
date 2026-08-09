import type { SanitizerStage } from './sanitizerState'

interface TaskProgressProps {
  stage: SanitizerStage
  progress: number
  message: string
  cancelling: boolean
  onCancel(): void
}

export function TaskProgress(props: TaskProgressProps): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, Math.round(props.progress * 100)))
  const verifying = props.stage === 'verifying'
  return (
    <section className="panel progress-panel" aria-labelledby="progress-title" aria-live="polite">
      <div className="panel-heading">
        <div>
          <p className="step-label">步骤 3</p>
          <h2 id="progress-title">{verifying ? '正在强制验证' : '正在生成清洗副本'}</h2>
        </div>
        <span className="progress-value">{percentage}%</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-label="任务进度"
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="progress-copy">
        <span className="activity-dot" aria-hidden="true" />
        <p>{props.message}</p>
      </div>
      <div className="safety-note">
        <strong>安全门保持开启</strong>
        <span>原文件只读，完成验证前不会把临时结果作为成功文件交付。</span>
      </div>
      <button
        className="button danger-outline"
        type="button"
        onClick={props.onCancel}
        disabled={props.cancelling}
      >
        {props.cancelling ? '正在取消…' : '取消任务'}
      </button>
    </section>
  )
}

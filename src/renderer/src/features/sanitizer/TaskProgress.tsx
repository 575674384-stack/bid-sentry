import { ProgressBar } from '../../components/ui'
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
    <section className="card" aria-labelledby="sanitizer-progress-title" aria-live="polite">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="sanitizer-progress-title">
            {verifying ? '正在验证清洗结果' : '正在清洗'}
          </h2>
          <p className="card-sub">{props.message}</p>
        </div>
        <span className="badge badge-primary">{percentage}%</span>
      </div>

      <div className="card-stack">
        <ProgressBar value={props.progress} label="清洗任务进度" />
        <p className="muted text-sm">
          安全门保持开启：原文件只读，验证通过前不会把临时结果作为成功文件交付。
        </p>
        <div>
          <button
            className="btn btn-danger"
            type="button"
            data-testid="sanitizer-cancel"
            onClick={props.onCancel}
            disabled={props.cancelling}
          >
            {props.cancelling ? '正在取消…' : '取消任务'}
          </button>
        </div>
      </div>
    </section>
  )
}

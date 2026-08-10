import { Button, Card, Progress } from 'antd'
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
    <Card title={verifying ? '正在验证清洗结果' : '正在清洗'} aria-live="polite">
      <div className="stack">
        <Progress
          percent={percentage}
          status="active"
          strokeColor="#1f3a5f"
          aria-label="清洗任务进度"
        />
        <span className="muted text-sm">{props.message}</span>
        <div>
          <Button
            danger
            data-testid="sanitizer-cancel"
            onClick={props.onCancel}
            disabled={props.cancelling}
          >
            {props.cancelling ? '正在取消…' : '取消任务'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

import { useEffect, useState } from 'react'
import { Alert, Button, Card, Spin, Steps } from 'antd'
import type { AiSettings, AppError } from '../../../../shared/contracts'
import { bidSentryApi } from '../../api/bidSentryApi'
import { FileSelection } from './FileSelection'
import { PreviewPanel } from './PreviewPanel'
import { ResultPanel } from './ResultPanel'
import { TaskProgress } from './TaskProgress'
import { useSanitizationTask } from './useSanitizationTask'

const STEPS = [
  { title: '选择文件' },
  { title: '安全预览' },
  { title: '执行清洗' },
  { title: '完成' }
]

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
      <div className="stack" data-testid="sanitizer-page">
        {state.errorMessage ? <Alert type="warning" showIcon title={state.errorMessage} /> : null}
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
      <div className="stack" data-testid="sanitizer-page">
        <Card>
          <div className="stack" style={{ alignItems: 'flex-start' }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>
              {cancelled ? '任务已取消' : '任务已安全停止'}
            </h2>
            <span className="muted text-sm">
              {cancelled
                ? '没有生成或替换任何文件，原文件保持不变。'
                : (state.errorMessage ?? state.progressMessage)}
            </span>
            {!cancelled && state.diagnosticError ? (
              <DiagnosticDetails error={state.diagnosticError} />
            ) : null}
            <Button type="primary" data-testid="sanitizer-reset" onClick={controller.reset}>
              返回并重新选择
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="stack" data-testid="sanitizer-page">
      <Steps
        size="small"
        current={STEP_INDEX[state.stage] ?? 0}
        items={STEPS}
        style={{ maxWidth: 560 }}
      />

      {state.errorMessage ? (
        <Alert type="error" showIcon title="操作未完成" description={state.errorMessage} />
      ) : null}

      {state.stage === 'idle' || state.stage === 'selecting' ? (
        <Card>
          <div className="stack">
            <FileSelection
              files={state.files}
              selecting={state.stage === 'selecting'}
              disabled={state.stage !== 'idle'}
              outputInfo={outputInfo}
              onSelect={() => void controller.selectFiles()}
              onRemove={controller.removeFile}
            />
            {state.files.length > 0 ? (
              <div className="actions">
                <Button
                  type="primary"
                  data-testid="sanitizer-preview"
                  disabled={!controller.canPreview}
                  onClick={() => void controller.createPreview()}
                >
                  生成安全预览
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {state.stage === 'previewing' ? (
        <Card>
          <Spin /> <span className="muted text-sm">正在检查文件结构并读取元数据…</span>
        </Card>
      ) : null}

      {state.stage === 'awaiting-confirmation' && state.preview ? (
        <>
          <h2 style={{ margin: 0, fontSize: 16 }}>清洗预览</h2>
          <PreviewPanel
            preview={state.preview}
            acknowledged={state.acknowledged}
            outputInfo={outputInfo}
            onAcknowledgedChange={controller.setAcknowledged}
          />
          <div className="actions">
            <Button disabled={state.cancelling} onClick={() => void controller.cancel()}>
              {state.cancelling ? '正在放弃…' : '放弃预览'}
            </Button>
            <Button
              type="primary"
              data-testid="sanitizer-execute"
              disabled={!controller.canExecute}
              onClick={() => void controller.execute()}
            >
              确认并开始清洗
            </Button>
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
  return `输出位置：与原文件同目录，文件名加后缀「${settings.outputSuffix}」（可在设置中修改）`
}

function DiagnosticDetails({ error }: { error: AppError }): React.JSX.Element {
  const summary = [
    `Bid Sentry ${error.code}`,
    `阶段: ${error.stage ?? 'unknown'}`,
    `诊断编号: ${error.detailId ?? '未生成'}`
  ].join('\n')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span className="muted text-sm">
        错误码：{error.code} · 阶段：{error.stage ?? 'unknown'}
        {error.detailId ? ` · 诊断编号：${error.detailId}` : ''}
      </span>
      <Button size="small" onClick={() => void navigator.clipboard?.writeText(summary)}>
        复制诊断摘要
      </Button>
    </div>
  )
}

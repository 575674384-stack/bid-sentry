import type { ReactNode } from 'react'
import { IconCheck } from './icons'

export interface StepItem {
  readonly key: string
  readonly label: string
}

/**
 * Horizontal workflow stepper. `current` is the index of the active step;
 * every step before it renders as done. Pass `current >= steps.length` when
 * the whole flow has finished.
 */
export function Stepper({
  steps,
  current
}: {
  readonly steps: readonly StepItem[]
  readonly current: number
}): React.JSX.Element {
  return (
    <ol className="stepper" aria-label="流程步骤">
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <li key={step.key} style={{ display: 'contents' }}>
            <div
              className={`step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className="step-dot">{done ? <IconCheck size={13} /> : index + 1}</span>
              <span className="step-name">{step.label}</span>
            </div>
            {index < steps.length - 1 ? (
              <div className={`step-connector${done ? ' is-done' : ''}`} aria-hidden="true" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export function Notice({
  tone,
  title,
  children
}: {
  readonly tone: NoticeTone
  readonly title?: string
  readonly children?: ReactNode
}): React.JSX.Element {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="notice-body">
        {title ? <span className="notice-title">{title}</span> : null}
        {children}
      </div>
    </div>
  )
}

export function ProgressBar({
  value,
  label
}: {
  readonly value: number
  readonly label: string
}): React.JSX.Element {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      aria-label={label}
    >
      <span style={{ width: `${percentage}%` }} />
    </div>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

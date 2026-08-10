import type { MetadataPreviewItem, SanitizationPreview } from '../../../../shared/contracts'
import { Notice } from '../../components/ui'
import { hasBlockers } from './sanitizerState'

interface PreviewPanelProps {
  preview: SanitizationPreview
  acknowledged: boolean
  outputInfo: string | null
  onAcknowledgedChange(value: boolean): void
}

const ACTION_LABELS = {
  randomize: '随机重置',
  preserve: '保留原值',
  warn: '仅提示'
} as const

export function PreviewPanel(props: PreviewPanelProps): React.JSX.Element {
  const blocked = hasBlockers(props.preview)
  return (
    <section className="card" aria-labelledby="sanitizer-preview-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="sanitizer-preview-title">
            清洗预览
          </h2>
          <p className="card-sub">
            字段原值与新值仅显示在当前窗口，不会写入报告、历史或诊断；关闭页面即失效。
          </p>
        </div>
        <span className={`badge ${blocked ? 'badge-danger' : 'badge-success'}`}>
          {blocked ? '存在阻断项' : '可以执行'}
        </span>
      </div>

      <div className="card-stack">
        {props.preview.files.map((file) => {
          const counts = countActions(file.fields)
          const items = file.items ?? []
          return (
            <article className="preview-file" key={file.inputId}>
              <div className="preview-file-head">
                <span className={`file-tag file-tag-${file.documentType}`}>
                  {file.documentType}
                </span>
                <span className="file-name" title={file.displayName}>
                  {file.displayName}
                </span>
                <span className="file-size">
                  {file.fields.reduce((sum, field) => sum + field.occurrences, 0)} 处元数据
                </span>
              </div>

              {counts.length ? (
                <div className="stat-row" aria-label="处理方式统计">
                  {counts.map(([action, count]) => (
                    <span className="stat-chip" key={action}>
                      {ACTION_LABELS[action]} <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted text-sm">没有发现需要处理的元数据字段。</p>
              )}

              {items.length > 0 ? (
                <div className="table-wrap">
                  <table className="table" data-testid="metadata-table">
                    <thead>
                      <tr>
                        <th scope="col">字段</th>
                        <th scope="col">当前值</th>
                        <th scope="col">清洗后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <PreviewRow key={`${item.part}:${item.locator}`} item={item} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {file.warnings.length ? (
                <Notice tone="warning" title="需要注意">
                  <ul>
                    {file.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}

              {file.blockers.length ? (
                <Notice tone="danger" title="无法处理">
                  <ul>
                    {file.blockers.map((blocker) => (
                      <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
            </article>
          )
        })}

        {!blocked ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={props.acknowledged}
                onChange={(event) => props.onAcknowledgedChange(event.currentTarget.checked)}
              />
              <span>
                <span className="check-title">我已核对预览内容，确认执行清洗</span>
                <span className="check-hint">
                  身份类字段随机重置，时间信息保留原值；清洗结果必须通过内容与结构验证才会发布。
                </span>
              </span>
            </label>
            {props.outputInfo ? <p className="output-line">{props.outputInfo}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  )
}

function PreviewRow({ item }: { item: MetadataPreviewItem }): React.JSX.Element {
  return (
    <tr>
      <td>
        <strong>{item.field}</strong>
        <div className="muted text-sm">{item.part}</div>
      </td>
      <td className="cell-value">{item.originalDisplayValue}</td>
      <td>
        {item.action === 'preserve' ? (
          <span className="badge badge-success">保留原值</span>
        ) : item.replacementDisplayValue !== null ? (
          <span className="cell-value">{item.replacementDisplayValue}</span>
        ) : (
          <span className="badge badge-neutral">保持原值</span>
        )}
      </td>
    </tr>
  )
}

function countActions(
  fields: SanitizationPreview['files'][number]['fields']
): Array<[keyof typeof ACTION_LABELS, number]> {
  const counts = new Map<keyof typeof ACTION_LABELS, number>()
  for (const field of fields) {
    counts.set(field.action, (counts.get(field.action) ?? 0) + field.occurrences)
  }
  return [...counts.entries()]
}

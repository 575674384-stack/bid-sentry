import type { SanitizationPreview } from '../../../../shared/contracts'
import { hasBlockers } from './sanitizerState'

interface PreviewPanelProps {
  preview: SanitizationPreview
  acknowledged: boolean
  outputReady: boolean
  onAcknowledgedChange(value: boolean): void
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'person-identity': '人员身份',
  organization: '组织信息',
  application: '制作软件',
  timestamp: '时间信息',
  'document-identifier': '文档标识',
  description: '描述信息',
  'custom-property': '自定义属性',
  'comment-identity': '批注身份',
  'revision-identity': '修订身份',
  other: '其他元数据'
}

export function PreviewPanel(props: PreviewPanelProps): React.JSX.Element {
  const blocked = hasBlockers(props.preview)
  return (
    <section className="panel" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">步骤 2</p>
          <h2 id="preview-title">检查修改范围</h2>
        </div>
        <span className={`status-chip ${blocked ? 'danger' : 'success'}`}>
          {blocked ? '存在阻断项' : '可以安全执行'}
        </span>
      </div>

      <p className="panel-intro">
        以下为本次任务实际使用的随机计划：字段名、清洗前原值和随机新值仅保留在当前窗口内，
        不会写入报告、历史或诊断。
      </p>

      <div className="preview-files">
        {props.preview.files.map((file) => {
          const categories = countCategories(file.fields)
          return (
            <article className="preview-file" key={file.inputId}>
              <div className="preview-file-title">
                <div>
                  <span className={`type-pill ${file.documentType}`}>{file.documentType}</span>
                  <h3>{file.displayName}</h3>
                </div>
                <span>{file.fields.reduce((sum, field) => sum + field.occurrences, 0)} 处字段</span>
              </div>

              {categories.length ? (
                <div className="category-grid">
                  {categories.map(([category, count]) => (
                    <div className="category-item" key={category}>
                      <span>{CATEGORY_LABELS[category] ?? category}</span>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="quiet-message">没有发现需要重置的元数据字段。</p>
              )}

              {(file.items?.length ?? 0) > 0 ? (
                <div className="metadata-details" aria-label={`${file.displayName} 元数据明细`}>
                  <div className="metadata-details-heading">
                    <strong>字段明细</strong>
                    <span>共 {file.items?.length ?? 0} 项</span>
                  </div>
                  <div className="metadata-table-wrap">
                    <table className="metadata-table">
                      <thead>
                        <tr>
                          <th>字段</th>
                          <th>清洗前原值</th>
                          <th>随机新值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(file.items ?? []).map((item) => (
                          <tr key={`${item.part}:${item.locator}`}>
                            <td>
                              <strong>{item.field}</strong>
                              <small>{item.part}</small>
                            </td>
                            <td className="metadata-value">{item.originalDisplayValue}</td>
                            <td className="metadata-value replacement">
                              {item.replacementDisplayValue ?? '保持不变'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {file.warnings.length ? (
                <div className="notice warning" role="status">
                  <strong>注意</strong>
                  <ul>
                    {file.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {file.blockers.length ? (
                <div className="notice danger" role="alert">
                  <strong>不能处理</strong>
                  <ul>
                    {file.blockers.map((blocker) => (
                      <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>

      {!blocked ? (
        <label className="confirmation-box">
          <input
            type="checkbox"
            checked={props.acknowledged}
            onChange={(event) => props.onAcknowledgedChange(event.currentTarget.checked)}
          />
          <span>
            <strong>我已查看修改类别，并同意生成新的清洗副本。</strong>
            <small>应用会强制验证正文和结构；验证失败不会发布结果。</small>
          </span>
        </label>
      ) : null}

      {!props.outputReady && !blocked ? (
        <p className="inline-hint">还需要在步骤 1 选择输出目录，才能开始清洗。</p>
      ) : null}
    </section>
  )
}

function countCategories(
  fields: SanitizationPreview['files'][number]['fields']
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const field of fields) {
    counts.set(field.category, (counts.get(field.category) ?? 0) + field.occurrences)
  }
  return [...counts.entries()]
}

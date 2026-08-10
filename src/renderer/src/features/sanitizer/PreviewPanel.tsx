import { Alert, Card, Checkbox, Table, Tag, Typography } from 'antd'
import type { MetadataPreviewItem, SanitizationPreview } from '../../../../shared/contracts'
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

const ACTION_COLORS: Readonly<Record<keyof typeof ACTION_LABELS, string>> = {
  randomize: 'processing',
  preserve: 'success',
  warn: 'warning'
}

export function PreviewPanel(props: PreviewPanelProps): React.JSX.Element {
  const blocked = hasBlockers(props.preview)
  return (
    <div className="stack">
      {props.preview.files.map((file) => {
        const counts = countActions(file.fields)
        const items = file.items ?? []
        return (
          <Card
            key={file.inputId}
            size="small"
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Tag color={file.documentType === 'docx' ? 'geekblue' : 'volcano'}>
                  {file.documentType}
                </Tag>
                <span className="file-name" title={file.displayName}>
                  {file.displayName}
                </span>
              </span>
            }
            extra={
              <span className="muted text-sm mono">
                {file.fields.reduce((sum, field) => sum + field.occurrences, 0)} 处元数据
              </span>
            }
          >
            <div className="stack">
              {counts.length ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {counts.map(([action, count]) => (
                    <Tag key={action} color={ACTION_COLORS[action]}>
                      {ACTION_LABELS[action]} {count}
                    </Tag>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  没有发现需要处理的元数据字段。
                </Typography.Text>
              )}

              {items.length > 0 ? (
                <Table<MetadataPreviewItem>
                  data-testid="metadata-table"
                  size="small"
                  rowKey={(item) => `${item.part}:${item.locator}`}
                  pagination={false}
                  scroll={{ y: 320 }}
                  columns={[
                    {
                      title: '字段',
                      key: 'field',
                      width: 220,
                      render: (_, item) => (
                        <>
                          <strong>{item.field}</strong>
                          <div className="muted text-sm">{item.part}</div>
                        </>
                      )
                    },
                    {
                      title: '当前值',
                      key: 'original',
                      render: (_, item) => (
                        <span style={{ userSelect: 'text', overflowWrap: 'anywhere' }}>
                          {item.originalDisplayValue}
                        </span>
                      )
                    },
                    {
                      title: '清洗后',
                      key: 'replacement',
                      render: (_, item) =>
                        item.action === 'preserve' ? (
                          <Tag color="success">保留原值</Tag>
                        ) : item.replacementDisplayValue !== null ? (
                          <span style={{ userSelect: 'text', overflowWrap: 'anywhere' }}>
                            {item.replacementDisplayValue}
                          </span>
                        ) : (
                          <Tag>保持原值</Tag>
                        )
                    }
                  ]}
                  dataSource={items}
                />
              ) : null}

              {file.warnings.length ? (
                <Alert
                  type="warning"
                  showIcon
                  title="需要注意"
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {file.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}

              {file.blockers.length ? (
                <Alert
                  type="error"
                  showIcon
                  title="无法处理"
                  description={
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                      {file.blockers.map((blocker) => (
                        <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}
            </div>
          </Card>
        )
      })}

      {!blocked ? (
        <>
          <Checkbox
            checked={props.acknowledged}
            onChange={(event) => props.onAcknowledgedChange(event.target.checked)}
          >
            我已核对预览内容，确认执行清洗
          </Checkbox>
          {props.outputInfo ? <span className="muted text-sm">{props.outputInfo}</span> : null}
        </>
      ) : null}
    </div>
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

import { Button, Card, Tag } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import type { SanitizationTaskResult } from '../../../../shared/contracts'

interface ResultPanelProps {
  result: SanitizationTaskResult
  onShowFile(fileId: string): void
  onReset(): void
}

const KIND_LABELS: Readonly<Record<SanitizationTaskResult['files'][number]['kind'], string>> = {
  'sanitized-document': '清洗文件',
  'json-report': 'JSON 报告',
  'html-report': 'HTML 报告'
}

export function ResultPanel(props: ResultPanelProps): React.JSX.Element {
  const { report } = props.result
  return (
    <Card>
      <div className="stack" style={{ alignItems: 'flex-start' }}>
        <h2 style={{ margin: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircleFilled style={{ color: '#1a7a4a' }} />
          清洗完成，全部文件已通过验证
        </h2>
        <span className="muted text-sm">原文件未被修改；清洗副本与报告已写入原文件所在目录。</span>

        <div style={{ display: 'flex', gap: 24 }}>
          <Stat value={report.files.length} label="清洗文件" />
          <Stat value={countChangedFields(props.result)} label="重置字段" />
          <Stat value="100%" label="验证通过" />
        </div>

        <ul className="file-list" style={{ width: '100%' }}>
          {props.result.files.map((file) => (
            <li className="file-row" key={file.fileId}>
              <Tag>{KIND_LABELS[file.kind]}</Tag>
              <span className="file-name" title={file.displayName}>
                {file.displayName}
              </span>
              <Button
                type="link"
                size="small"
                aria-label={`在文件夹中显示 ${file.displayName}`}
                onClick={() => props.onShowFile(file.fileId)}
              >
                在文件夹中显示
              </Button>
            </li>
          ))}
        </ul>

        <Button type="primary" data-testid="sanitizer-reset" onClick={props.onReset}>
          开始新的清洗
        </Button>
      </div>
    </Card>
  )
}

function Stat({ value, label }: { value: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <strong style={{ fontSize: 20 }} className="mono">
        {value}
      </strong>
      <span className="muted text-sm">{label}</span>
    </span>
  )
}

function countChangedFields(result: SanitizationTaskResult): number {
  return result.report.files.reduce(
    (fileTotal, file) =>
      fileTotal +
      file.fields.reduce(
        (fieldTotal, field) => fieldTotal + (field.status === 'changed' ? field.occurrences : 0),
        0
      ),
    0
  )
}

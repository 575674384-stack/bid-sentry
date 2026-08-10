import type { SanitizationTaskResult } from '../../../../shared/contracts'
import { IconCheck } from '../../components/icons'

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
    <section className="card terminal-card" aria-labelledby="sanitizer-result-title">
      <span className="terminal-icon is-success" aria-hidden="true">
        <IconCheck size={26} />
      </span>
      <h2 className="terminal-title" id="sanitizer-result-title">
        清洗完成，全部文件已通过验证
      </h2>
      <p className="terminal-desc">原文件未被修改；清洗副本与报告已写入各自原文件所在目录。</p>

      <div className="result-stats" aria-label="完成摘要">
        <div className="result-stat">
          <strong>{report.files.length}</strong>
          <span>清洗文件</span>
        </div>
        <div className="result-stat">
          <strong>{countChangedFields(props.result)}</strong>
          <span>重置字段</span>
        </div>
        <div className="result-stat">
          <strong>100%</strong>
          <span>验证通过</span>
        </div>
      </div>

      <div className="result-files">
        {props.result.files.map((file) => (
          <div className="result-file-row" key={file.fileId}>
            <span className="badge badge-neutral">{KIND_LABELS[file.kind]}</span>
            <span className="file-name" title={file.displayName}>
              {file.displayName}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              aria-label={`在文件夹中显示 ${file.displayName}`}
              onClick={() => props.onShowFile(file.fileId)}
            >
              在文件夹中显示
            </button>
          </div>
        ))}
      </div>

      <div className="btn-row">
        <button
          className="btn btn-primary"
          type="button"
          data-testid="sanitizer-reset"
          onClick={props.onReset}
        >
          开始新的清洗
        </button>
      </div>
    </section>
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

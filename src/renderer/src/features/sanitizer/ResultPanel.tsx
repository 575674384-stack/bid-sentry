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
  return (
    <section className="panel result-panel" aria-labelledby="result-title">
      <div className="success-mark" aria-hidden="true">
        ✓
      </div>
      <div className="result-heading">
        <p className="step-label">处理完成</p>
        <h2 id="result-title">全部文件已通过强制验证</h2>
        <p>原文件未被修改。新文件和两种报告已经写入你选择的输出目录。</p>
      </div>

      <div className="result-summary" aria-label="完成摘要">
        <div>
          <strong>{props.result.report.files.length}</strong>
          <span>清洗文件</span>
        </div>
        <div>
          <strong>{countChangedFields(props.result)}</strong>
          <span>重置字段</span>
        </div>
        <div>
          <strong>100%</strong>
          <span>验证通过</span>
        </div>
      </div>

      <div className="result-files">
        {props.result.files.map((file) => (
          <div className="result-row" key={file.fileId}>
            <div>
              <span className="result-kind">{KIND_LABELS[file.kind]}</span>
              <strong>{file.displayName}</strong>
            </div>
            <button
              className="button text-button"
              type="button"
              onClick={() => props.onShowFile(file.fileId)}
              aria-label={`在文件夹中显示 ${file.displayName}`}
            >
              在文件夹中显示
            </button>
          </div>
        ))}
      </div>

      <div className="result-actions">
        <button className="button primary" type="button" onClick={props.onReset}>
          处理另一批文件
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

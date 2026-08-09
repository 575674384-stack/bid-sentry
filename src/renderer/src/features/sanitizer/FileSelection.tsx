import type { SelectedInputFile, SelectedOutputDirectory } from '../../../../shared/contracts'

interface FileSelectionProps {
  files: readonly SelectedInputFile[]
  outputDirectory: SelectedOutputDirectory | null
  filesDisabled: boolean
  outputDisabled: boolean
  selecting: boolean
  onSelectFiles(): void
  onSelectOutput(): void
}

export function FileSelection(props: FileSelectionProps): React.JSX.Element {
  return (
    <section className="panel" aria-labelledby="file-selection-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">步骤 1</p>
          <h2 id="file-selection-title">选择本地文件</h2>
        </div>
        <span className="privacy-badge">路径不会发送到界面之外</span>
      </div>

      <div className="selection-grid">
        <div className="drop-card">
          <div className="file-mark" aria-hidden="true">
            DOC
          </div>
          <div>
            <h3>DOCX / PDF</h3>
            <p>一次最多选择 20 个文件。DOC、DOCM、加密或签名文件会被安全拒绝。</p>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={props.onSelectFiles}
            disabled={props.filesDisabled}
          >
            {props.selecting ? '正在打开…' : props.files.length ? '重新选择文件' : '选择文件'}
          </button>
        </div>

        <div className="output-card">
          <span className="field-label">输出位置</span>
          <strong>{props.outputDirectory?.displayName ?? '尚未选择'}</strong>
          <p>只显示目录名称；应用不会覆盖已有文件。</p>
          <button
            className="button secondary"
            type="button"
            onClick={props.onSelectOutput}
            disabled={props.outputDisabled}
          >
            选择输出目录
          </button>
        </div>
      </div>

      {props.files.length > 0 ? (
        <div className="file-list" aria-label="已选择文件">
          {props.files.map((file) => (
            <div className="file-row" key={file.inputId}>
              <span className={`type-pill ${file.documentType}`}>{file.documentType}</span>
              <span className="file-name" title={file.displayName}>
                {file.displayName}
              </span>
              <span className="file-size">{formatBytes(file.size)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

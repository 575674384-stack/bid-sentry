import type { SelectedInputFile } from '../../../../shared/contracts'
import { IconFile, IconFolder, IconX } from '../../components/icons'
import { formatBytes } from '../../components/ui'

interface FileSelectionProps {
  files: readonly SelectedInputFile[]
  selecting: boolean
  disabled: boolean
  outputInfo: string | null
  onSelect(): void
  onRemove(inputId: string): void
}

export function FileSelection(props: FileSelectionProps): React.JSX.Element {
  return (
    <section className="card" aria-labelledby="sanitizer-select-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="sanitizer-select-title">
            选择需要清洗的文件
          </h2>
          <p className="card-sub">
            支持 DOCX / PDF，一次最多 20 个；加密、签名或损坏的文件会被安全拒绝。
          </p>
        </div>
        <span className="badge badge-neutral">原文件只读</span>
      </div>

      <div className="card-stack">
        <div className="dropzone">
          <span className="dropzone-icon" aria-hidden="true">
            <IconFile size={22} />
          </span>
          <div className="dropzone-text">
            <p className="dropzone-title">从本机选择标书文件</p>
            <p className="dropzone-desc">文件不会离开本机；应用只读取内容和元数据用于预览。</p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="sanitizer-select-files"
            onClick={props.onSelect}
            disabled={props.disabled}
          >
            {props.selecting ? '正在打开…' : props.files.length ? '重新选择文件' : '选择文件'}
          </button>
        </div>

        {props.files.length > 0 ? (
          <ul className="file-list" aria-label="已选择的文件">
            {props.files.map((file) => (
              <li className="file-row" key={file.inputId}>
                <span className={`file-tag file-tag-${file.documentType}`}>
                  {file.documentType}
                </span>
                <span className="file-name" title={file.displayName}>
                  {file.displayName}
                </span>
                <span className="file-size">{formatBytes(file.size)}</span>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`移除 ${file.displayName}`}
                  onClick={() => props.onRemove(file.inputId)}
                  disabled={props.disabled}
                >
                  <IconX />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {props.outputInfo ? (
          <p className="output-line">
            <IconFolder />
            <span>{props.outputInfo}</span>
          </p>
        ) : null}
      </div>
    </section>
  )
}

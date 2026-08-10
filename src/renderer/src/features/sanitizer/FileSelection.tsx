import { Button, Tag } from 'antd'
import { CloseOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { SelectedInputFile } from '../../../../shared/contracts'
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
    <div className="stack">
      <div className="dropzone">
        <div className="dropzone-text">
          <p className="dropzone-title">选择需要清洗的文件</p>
          <p className="dropzone-desc">DOCX / PDF，一次最多 20 个；文件不会离开本机。</p>
        </div>
        <Button
          type="primary"
          data-testid="sanitizer-select-files"
          onClick={props.onSelect}
          disabled={props.disabled}
        >
          {props.selecting ? '正在打开…' : props.files.length ? '重新选择文件' : '选择文件'}
        </Button>
      </div>

      {props.files.length > 0 ? (
        <ul className="file-list" aria-label="已选择的文件">
          {props.files.map((file) => (
            <li className="file-row" key={file.inputId}>
              <Tag color={file.documentType === 'docx' ? 'geekblue' : 'volcano'}>
                {file.documentType}
              </Tag>
              <span className="file-name" title={file.displayName}>
                {file.displayName}
              </span>
              <span className="file-size">{formatBytes(file.size)}</span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label={`移除 ${file.displayName}`}
                onClick={() => props.onRemove(file.inputId)}
                disabled={props.disabled}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {props.outputInfo ? (
        <span className="muted text-sm">
          <FolderOpenOutlined style={{ marginRight: 6 }} />
          {props.outputInfo}
        </span>
      ) : null}
    </div>
  )
}

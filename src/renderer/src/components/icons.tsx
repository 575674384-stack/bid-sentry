import {
  CheckOutlined,
  CloseOutlined,
  FileOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
  SettingOutlined
} from '@ant-design/icons'

interface IconProps {
  readonly size?: number
}

function wrap(Icon: React.ComponentType<{ style?: React.CSSProperties }>) {
  return function Wrapped({ size = 14 }: IconProps): React.JSX.Element {
    return <Icon style={{ fontSize: size }} />
  }
}

export const IconShield = wrap(SafetyCertificateOutlined)
export const IconCompare = wrap(FileSearchOutlined)
export const IconDocSpark = wrap(FileTextOutlined)
export const IconGear = wrap(SettingOutlined)
export const IconFile = wrap(FileOutlined)
export const IconFolder = wrap(FolderOpenOutlined)
export const IconX = wrap(CloseOutlined)
export const IconCheck = wrap(CheckOutlined)
export const IconInfo = wrap(InfoCircleOutlined)

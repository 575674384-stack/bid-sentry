import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'dayjs/locale/zh-cn'
import { App } from './App'
import { bidSentryTheme } from './theme'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found.')
}

createRoot(root).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={bidSentryTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>
)

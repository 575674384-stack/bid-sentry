import { useState } from 'react'
import { SanitizerPage } from './features/sanitizer/SanitizerPage'
import { SettingsPage } from './features/settings/SettingsPage'

type Page = 'sanitizer' | 'settings'

const PAGE_COPY: Readonly<Record<Page, { eyebrow: string; title: string; description: string }>> = {
  sanitizer: {
    eyebrow: '元数据安全重置',
    title: '清洗文档隐藏信息',
    description: '生成经过结构与内容验证的新副本，原文件始终只读。'
  },
  settings: {
    eyebrow: '本机设置',
    title: '配置 AI 接口',
    description: '保存自己的 OpenAI 兼容接口，为后续对照审查能力做好准备。'
  }
}

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('sanitizer')
  const copy = PAGE_COPY[page]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            <strong>Bid Sentry</strong>
            <span>文档安全助手</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要功能">
          <button
            type="button"
            className={page === 'sanitizer' ? 'active' : ''}
            aria-current={page === 'sanitizer' ? 'page' : undefined}
            onClick={() => setPage('sanitizer')}
          >
            <span className="nav-icon" aria-hidden="true">
              ◇
            </span>
            <span>
              <strong>隐私清洗</strong>
              <small>DOCX / PDF</small>
            </span>
          </button>
          <button
            type="button"
            className={page === 'settings' ? 'active' : ''}
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => setPage('settings')}
          >
            <span className="nav-icon" aria-hidden="true">
              ⚙
            </span>
            <span>
              <strong>AI 设置</strong>
              <small>自备接口</small>
            </span>
          </button>
        </nav>

        <div className="sidebar-trust">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>单机运行</strong>
            <span>原文件只读 · 验证后发布</span>
          </div>
        </div>
        <p className="sidebar-version">M1 · 开源本地工具</p>
      </aside>

      <main className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <span className="local-badge">
            <span aria-hidden="true">●</span> 本机安全模式
          </span>
        </header>

        <div hidden={page !== 'sanitizer'}>
          <SanitizerPage />
        </div>
        <div hidden={page !== 'settings'}>
          <SettingsPage />
        </div>
      </main>
    </div>
  )
}

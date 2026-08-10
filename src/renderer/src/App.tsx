import { useState } from 'react'
import { IconCompare, IconDocSpark, IconGear, IconShield } from './components/icons'
import { SanitizerPage } from './features/sanitizer/SanitizerPage'
import { ReviewPage } from './features/review/ReviewPage'
import { GenerationPage } from './features/generation/GenerationPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { SidebarUpdateBadge } from './features/updates/UpdateStatus'

declare const __BID_SENTRY_VERSION__: string

type Page = 'sanitizer' | 'review' | 'generation' | 'settings'

interface PageMeta {
  readonly label: string
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly icon: (props: { size?: number }) => React.JSX.Element
}

const PAGES: Readonly<Record<Page, PageMeta>> = {
  sanitizer: {
    label: '隐私清洗',
    eyebrow: '元数据安全',
    title: '隐私清洗',
    description: '重置 DOCX / PDF 中可泄露身份的隐藏元数据；原文件只读，输出经强制验证后才会发布。',
    icon: IconShield
  },
  review: {
    label: '对照审查',
    eyebrow: '招标 / 投标一致性',
    title: '对照审查',
    description: '以招标文件为基准核查投标文件，本机确定性规则优先，AI 仅在你明确确认后辅助。',
    icon: IconCompare
  },
  generation: {
    label: '资格标预制作',
    eyebrow: '模板复用',
    title: '资格标预制作',
    description: '从招标文件中确认资格模板并预填草稿：固定值凭证据填充，图片证照以占位符代替。',
    icon: IconDocSpark
  },
  settings: {
    label: '设置',
    eyebrow: '本机配置',
    title: '设置',
    description: '管理 AI 接口、输出方式、公司资料预填与桌面行为，全部配置仅保存在本机。',
    icon: IconGear
  }
}

const NAV_ORDER: readonly Page[] = ['sanitizer', 'review', 'generation', 'settings']

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('sanitizer')
  const meta = PAGES[page]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.6 19 5.2v5.6c0 4.6-3 7.8-7 10-4-2.2-7-5.4-7-10V5.2l7-2.6Z"
                fill="#fff"
              />
              <path
                d="m8.8 11.9 2.2 2.2 4.2-4.5"
                stroke="#2f5cff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            <span className="brand-name">Bid Sentry</span>
            <span className="brand-sub">标书安全助手</span>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="主要功能">
          {NAV_ORDER.map((key) => {
            const item = PAGES[key]
            const Icon = item.icon
            const active = page === key
            return (
              <button
                key={key}
                type="button"
                className={`nav-item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setPage(key)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <SidebarUpdateBadge />
          <span className="sidebar-version">v{__BID_SENTRY_VERSION__} · 开源单机工具</span>
        </div>
      </aside>

      <main className="content">
        <div className="page">
          <header className="page-head">
            <p className="page-eyebrow">{meta.eyebrow}</p>
            <h1 className="page-title">{meta.title}</h1>
            <p className="page-desc">{meta.description}</p>
          </header>

          <div hidden={page !== 'sanitizer'}>
            <SanitizerPage active={page === 'sanitizer'} />
          </div>
          <div hidden={page !== 'review'}>
            <ReviewPage />
          </div>
          <div hidden={page !== 'generation'}>
            <GenerationPage />
          </div>
          <div hidden={page !== 'settings'}>
            <SettingsPage />
          </div>
        </div>
      </main>
    </div>
  )
}

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
  readonly icon: (props: { size?: number }) => React.JSX.Element
}

const PAGES: Readonly<Record<Page, PageMeta>> = {
  sanitizer: { label: '隐私清洗', icon: IconShield },
  review: { label: '对照审查', icon: IconCompare },
  generation: { label: '资格标预制作', icon: IconDocSpark },
  settings: { label: '设置', icon: IconGear }
}

const NAV_ORDER: readonly Page[] = ['sanitizer', 'review', 'generation', 'settings']

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('sanitizer')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.6 19 5.2v5.6c0 4.6-3 7.8-7 10-4-2.2-7-5.4-7-10V5.2l7-2.6Z"
                fill="#e5a23c"
              />
              <path
                d="m8.8 11.9 2.2 2.2 4.2-4.5"
                stroke="#101c2e"
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
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <SidebarUpdateBadge />
          <span className="sidebar-version">v{__BID_SENTRY_VERSION__}</span>
        </div>
      </aside>

      <main className="content">
        <div className="page">
          <h1 className="page-title">{PAGES[page].label}</h1>

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

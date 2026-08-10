import type { ThemeConfig } from 'antd'

/**
 * Bid Sentry visual identity: deep ink-navy primary with amber accents on a
 * warm paper background. Deliberately away from the default antd blue so the
 * product reads as a desktop instrument, not a web admin template.
 */
export const bidSentryTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1f3a5f',
    colorInfo: '#2f5f8f',
    colorSuccess: '#1a7a4a',
    colorWarning: '#c2740a',
    colorError: '#b3362b',
    colorBgLayout: '#f4f5f7',
    colorBgContainer: '#ffffff',
    colorBorder: '#dfe3ea',
    colorBorderSecondary: '#e9edf3',
    colorText: '#1c2434',
    colorTextSecondary: '#5a6577',
    borderRadius: 8,
    controlHeight: 34,
    fontFamily:
      '-apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    fontSize: 14
  },
  components: {
    Button: { fontWeight: 500 },
    Card: { paddingLG: 22 },
    Table: { headerBg: '#f6f8fb', headerColor: '#5a6577' },
    Steps: { iconSize: 26 },
    Alert: { borderRadiusLG: 8 },
    Form: { labelFontSize: 13, labelColor: '#3c465a' }
  }
}

export const BRAND_AMBER = '#e5a23c'

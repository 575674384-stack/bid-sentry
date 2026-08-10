/**
 * Inline stroke icons (24x24 viewBox). Decorative only — always rendered with
 * aria-hidden, never as the sole carrier of meaning.
 */

interface IconProps {
  readonly size?: number
}

function base(size: number): {
  width: number
  height: number
  viewBox: string
  fill: string
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round'
  strokeLinejoin: 'round'
  'aria-hidden': true
} {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  }
}

export function IconShield({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M12 3.2 18.8 5.8v5.3c0 4.3-2.9 7.3-6.8 9.4-3.9-2.1-6.8-5.1-6.8-9.4V5.8L12 3.2Z" />
      <path d="m9.2 11.8 2 2 3.7-4" />
    </svg>
  )
}

export function IconCompare({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M8 7h12" />
      <path d="m17 4 3 3-3 3" />
      <path d="M16 17H4" />
      <path d="m7 14-3 3 3 3" />
    </svg>
  )
}

export function IconDocSpark({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="m12 11.2.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7Z" />
    </svg>
  )
}

export function IconGear({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  )
}

export function IconFile({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M9 13h6M9 16.4h4" />
    </svg>
  )
}

export function IconFolder({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
    </svg>
  )
}

export function IconCheck({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} strokeWidth={2.4}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  )
}

export function IconX({ size = 13 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function IconAlert({ size = 15 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 16.8v.2" />
    </svg>
  )
}

export function IconInfo({ size = 15 }: IconProps): React.JSX.Element {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.8v.2" />
    </svg>
  )
}

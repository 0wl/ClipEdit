import { useEffect, useRef, type ReactNode, type ComponentType } from 'react'
import { ChevronRight, type LucideProps } from 'lucide-react'

export type Icon = ComponentType<LucideProps>

export const ICON = { size: 20, strokeWidth: 1.75 } as const

export function Logo({ size = 26 }: { size?: number }): ReactNode {
  // Mark: a clip bracketed by [ ] with a play triangle — ClipEdit in one glyph.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="#fff" aria-hidden="true">
      <rect x="2.5" y="3.5" width="3" height="25" rx="1.5" />
      <rect x="2.5" y="3.5" width="8" height="3" rx="1.5" />
      <rect x="2.5" y="25.5" width="8" height="3" rx="1.5" />
      <rect x="26.5" y="3.5" width="3" height="25" rx="1.5" />
      <rect x="21.5" y="3.5" width="8" height="3" rx="1.5" />
      <rect x="21.5" y="25.5" width="8" height="3" rx="1.5" />
      <path d="M13.2 10.4 23.2 16l-10 5.6Z" strokeLinejoin="round" stroke="#fff" strokeWidth="1" />
    </svg>
  )
}

export function Brand(): ReactNode {
  return (
    <div className="brand">
      <Logo />
      <span>ClipEdit</span>
    </div>
  )
}

export function NavItem(props: {
  icon: Icon
  label: string
  onClick?: () => void
  active?: boolean
  primary?: boolean
  disabled?: boolean
  hint?: string
  badge?: number
  testId?: string
}): ReactNode {
  const { icon: I, label, onClick, active, primary, disabled, hint, badge, testId } = props
  return (
    <button
      className={`nav-item${primary ? ' nav-item--primary' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <I {...ICON} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="badge">{badge}</span>}
      {hint && <span className="kbd-hint">{hint}</span>}
    </button>
  )
}

export function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }): ReactNode {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <span key={i} style={{ display: 'contents' }}>
            {last ? (
              <span className="current" title={it.label}>
                {it.label}
              </span>
            ) : it.onClick ? (
              <button onClick={it.onClick}>{it.label}</button>
            ) : (
              <span>{it.label}</span>
            )}
            {!last && <ChevronRight size={16} strokeWidth={2} />}
          </span>
        )
      })}
    </nav>
  )
}

export function Checkbox(props: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
  id?: string
  testId?: string
}): ReactNode {
  return (
    <span className="cbx">
      <input
        id={props.id}
        type="checkbox"
        role="checkbox"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testId}
      />
      <span className="cbx-box">
        <svg viewBox="0 0 12 12">
          <path d="M2.2 6.4 4.8 8.9 9.8 3.4" />
        </svg>
      </span>
    </span>
  )
}

export function Tip(props: {
  label: string
  kbd?: string[]
  children: ReactNode
  placement?: 'top' | 'bottom'
  align?: 'center' | 'end'
}): ReactNode {
  const { label, kbd, children, placement = 'top', align = 'center' } = props
  return (
    <span className={`tip-wrap${placement === 'bottom' ? ' below' : ''}${align === 'end' ? ' end' : ''}`}>
      {children}
      <span className="tip" role="tooltip">
        {label}
        {kbd && (
          <span className="kbd-group">
            {kbd.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </span>
        )}
      </span>
    </span>
  )
}

export function ProgressBar({ value, indeterminate, testId }: { value: number; indeterminate?: boolean; testId?: string }): ReactNode {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10
  return (
    <div
      className={`progress${indeterminate ? ' indeterminate' : ''}${value >= 1 ? ' done' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      data-testid={testId}
    >
      <div className="progress-fill" style={indeterminate ? undefined : { transform: `translateX(${pct - 100}%)` }} />
    </div>
  )
}

export function Modal(props: { children: ReactNode; onEscape?: () => void; label: string; testId?: string; initialFocus?: 'first' | 'last' }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const onEscape = props.onEscape
  const initialFocus = props.initialFocus ?? 'last'
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    // Focus the primary action (last button) for Enter-to-confirm; destructive
    // dialogs focus the first (Cancel) instead.
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>('.modal-foot button')
    btns?.[initialFocus === 'first' ? 0 : btns.length - 1]?.focus()
    return () => prev?.focus?.()
  }, [initialFocus])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation()
        onEscape()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onEscape])
  return (
    <div className="modal-backdrop" data-testid={props.testId}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.label} ref={ref}>
        {props.children}
      </div>
    </div>
  )
}

/** A rectangle drawn in the given aspect ratio (dashed with corner ticks for "free"). */
export function AspectIcon({ ratio }: { ratio: number | null }): ReactNode {
  if (ratio == null) {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" />
        <path d="M8 10h4M10 8v4" strokeOpacity="0.7" />
      </svg>
    )
  }
  const max = 15
  const w = ratio >= 1 ? max : max * ratio
  const h = ratio >= 1 ? max / ratio : max
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x={10 - w / 2} y={10 - h / 2} width={w} height={h} rx="2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}

/** Circular-arrow skip icon with the step in seconds drawn inside. */
export function SkipIcon({ dir, seconds = 5 }: { dir: 'back' | 'fwd'; seconds?: number }): ReactNode {
  const flip = dir === 'fwd' ? 'scale(-1,1) translate(-24,0)' : undefined
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g transform={flip} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 9.5A8 8 0 1 1 4 13" />
        <path d="M4.2 4.8v4.9h4.9" />
      </g>
      <text x="12.6" y="15.6" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" fontFamily="Inter Variable, Segoe UI, sans-serif">
        {seconds}
      </text>
    </svg>
  )
}

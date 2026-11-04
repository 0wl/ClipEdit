import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Icon } from './ui'

export type MenuEntry =
  | { kind?: 'item'; label: string; icon: Icon; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string; testId?: string }
  | { kind: 'separator' }

/** Custom right-click menu, positioned at the cursor and kept inside the window. */
export default function ContextMenu(props: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }): ReactNode {
  const { entries, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: props.x, y: props.y, ready: false })

  // Flip/clamp so the menu never spills out of the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    let x = props.x
    let y = props.y
    if (x + width > window.innerWidth - pad) x = Math.max(pad, x - width)
    if (y + height > window.innerHeight - pad) y = Math.max(pad, y - height)
    setPos({ x, y, ready: true })
  }, [props.x, props.y])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    const close = (): void => onClose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="ctx-menu"
    >
      {entries.map((en, i) =>
        en.kind === 'separator' ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item${en.danger ? ' danger' : ''}`}
            disabled={en.disabled}
            onClick={() => {
              onClose()
              en.onSelect()
            }}
            data-testid={en.testId}
          >
            <en.icon size={16} strokeWidth={1.9} />
            <span>{en.label}</span>
            {en.hint && <span className="ctx-hint">{en.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import { formatTime } from '@shared/time'
import { moveHandle, moveRange, timeFromX, isFullRange, type Range } from '@shared/trim'
import { useVideoClock } from './useVideoClock'

type Drag = null | 'start' | 'end' | 'body' | 'scrub'

// Major label step -> number of minor subdivisions.
const TICKS: [number, number][] = [
  [0.1, 5], [0.2, 4], [0.5, 5], [1, 5], [2, 4], [5, 5], [10, 5], [15, 3], [30, 6],
  [60, 6], [120, 4], [300, 5], [600, 5], [900, 3], [1800, 6], [3600, 6], [7200, 4]
]

export default function Timeline(props: {
  duration: number
  range: Range
  onRange: (r: Range) => void
  video: HTMLVideoElement | null
  seek: (t: number) => void
  thumbs: string[] | null
  onWidth?: (w: number) => void
}): ReactNode {
  const { duration, range, onRange, video, seek, thumbs, onWidth } = props
  const trackRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<Drag>(null)
  const dragRef = useRef<{ kind: Drag; offset: number; x0: number; r0: Range; moved: boolean; wasPlaying: boolean }>({
    kind: null, offset: 0, x0: 0, r0: range, moved: false, wasPlaying: false
  })
  const scrubTime = useRef<number | null>(null) // shows the pointer position instantly while seeking

  // Track width (for tick density + pixel math).
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      onWidth?.(el.clientWidth)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [onWidth])

  // Playhead follows the video without React re-renders.
  const placePlayhead = (t: number): void => {
    const el = playheadRef.current
    const tr = trackRef.current
    if (!el || !tr || duration <= 0) return
    const shown = scrubTime.current ?? t
    el.style.transform = `translateX(${(Math.min(duration, Math.max(0, shown)) / duration) * tr.clientWidth}px)`
  }
  useVideoClock(video, placePlayhead)
  useEffect(() => placePlayhead(video?.currentTime ?? 0)) // also after layout changes

  const pct = (t: number): string => `${(duration > 0 ? (t / duration) * 100 : 0).toFixed(4)}%`

  const xToTime = (clientX: number): number => {
    const r = trackRef.current!.getBoundingClientRect()
    return timeFromX(clientX - r.left, r.width, duration)
  }

  const begin = (e: RPointerEvent, kind: Exclude<Drag, null>, offset = 0): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const wasPlaying = !!video && !video.paused
    if (kind !== 'scrub') video?.pause()
    dragRef.current = { kind, offset, x0: e.clientX, r0: range, moved: false, wasPlaying }
    setDrag(kind)
    if (kind === 'scrub') scrubTo(xToTime(e.clientX)) // a plain click seeks too
  }

  const scrubTo = (t: number): void => {
    scrubTime.current = t
    placePlayhead(t)
    seek(t)
  }

  const onMove = (e: RPointerEvent): void => {
    const d = dragRef.current
    if (!d.kind) return
    if (d.kind === 'scrub') {
      scrubTo(xToTime(e.clientX))
      return
    }
    if (d.kind === 'start' || d.kind === 'end') {
      const t = xToTime(e.clientX + d.offset)
      const r = moveHandle(d.r0, d.kind, t, duration)
      onRange(r)
      scrubTo(d.kind === 'start' ? r.start : r.end)
      return
    }
    // body
    const dx = e.clientX - d.x0
    if (Math.abs(dx) > 3) d.moved = true
    if (!d.moved) return
    const tw = trackRef.current!.clientWidth || 1
    const r = moveRange(d.r0, (dx / tw) * duration, duration)
    onRange(r)
    scrubTo(r.start)
  }

  const end = (e: RPointerEvent): void => {
    const d = dragRef.current
    if (!d.kind) return
    if (d.kind === 'body' && !d.moved) scrubTo(xToTime(e.clientX)) // plain click inside the selection = seek
    dragRef.current = { ...d, kind: null }
    scrubTime.current = null
    setDrag(null)
  }

  const handleDown = (which: 'start' | 'end') => (e: RPointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect()
    const edgeX = r.left + (duration > 0 ? ((which === 'start' ? range.start : range.end) / duration) * r.width : 0)
    begin(e, which, edgeX - e.clientX)
  }

  const handleKey = (which: 'start' | 'end') => (e: RKeyboardEvent) => {
    // Arrow keys nudge a focused handle by one tenth of a second (Shift: 1s).
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1)
    const r = moveHandle(range, which, (which === 'start' ? range.start : range.end) + step, duration)
    onRange(r)
    seek(which === 'start' ? r.start : r.end)
  }

  const ticks = useMemo(() => {
    if (width <= 0 || duration <= 0) return []
    const maxLabels = Math.max(2, Math.floor(width / 84))
    const [step, sub] = TICKS.find(([s]) => duration / s <= maxLabels) ?? TICKS[TICKS.length - 1]
    const minor = step / sub
    const out: { t: number; major: boolean }[] = []
    const n = Math.floor(duration / minor + 1e-6)
    for (let i = 0; i <= n; i++) {
      const t = i * minor
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6
      out.push({ t, major })
    }
    return out.map((x) => ({ ...x, label: x.major ? formatTime(x.t, step < 1) : null }))
  }, [width, duration])

  const length = range.end - range.start
  const full = isFullRange(range, duration)

  return (
    <div className="timeline" data-testid="timeline">
      <div className="tl-head">
        <span className="tl-title">Timeline</span>
        <span className="chip" data-testid="chip-in">
          <span className="k">In</span>
          {formatTime(range.start)}
        </span>
        <span className="chip" data-testid="chip-out">
          <span className="k">Out</span>
          {formatTime(range.end)}
        </span>
        <span className="chip strong" data-testid="chip-len">
          <span className="k">Length</span>
          {formatTime(length)}
        </span>
        <span className="spacer" />
        {!full && (
          <button className="btn btn-ghost btn-sm" onClick={() => onRange({ start: 0, end: duration })} data-testid="reset-range">
            <RotateCcw size={14} strokeWidth={2} />
            Reset
          </button>
        )}
      </div>

      <div onPointerDown={(e) => begin(e, 'scrub')} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
        <div className="tl-ruler">
          {ticks.map((t) => (
            <div key={t.t} className={`tl-tick${t.major ? ' major' : ''}`} style={{ left: pct(t.t) }}>
              {t.label && <span>{t.label}</span>}
            </div>
          ))}
        </div>
        <div className="tl-track-wrap">
          <div className="tl-track" ref={trackRef} data-testid="tl-track">
            <div className="tl-film">
              {thumbs ? thumbs.map((src, i) => (src ? <img key={i} src={src} alt="" draggable={false} /> : <span key={i} style={{ flex: 1 }} />)) : <div className="tl-film-loading" />}
            </div>
            <div className="tl-dim left" style={{ width: pct(range.start) }} />
            <div className="tl-dim right" style={{ width: pct(duration - range.end) }} />
            <div
              className={`tl-sel${drag === 'body' ? ' dragging' : ''}`}
              style={{ left: pct(range.start), width: pct(length) }}
              onPointerDown={(e) => begin(e, 'body')}
              data-testid="tl-sel"
            >
              <div
                className={`tl-handle start${drag === 'start' ? ' active' : ''}`}
                onPointerDown={handleDown('start')}
                onKeyDown={handleKey('start')}
                tabIndex={0}
                role="slider"
                aria-label="Clip start"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={range.start}
                aria-valuetext={formatTime(range.start)}
                data-testid="handle-start"
              >
                <span className="bracket" />
                <span className="tl-handle-label">{formatTime(range.start)}</span>
              </div>
              <div
                className={`tl-handle end${drag === 'end' ? ' active' : ''}`}
                onPointerDown={handleDown('end')}
                onKeyDown={handleKey('end')}
                tabIndex={0}
                role="slider"
                aria-label="Clip end"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={range.end}
                aria-valuetext={formatTime(range.end)}
                data-testid="handle-end"
              >
                <span className="bracket" />
                <span className="tl-handle-label">{formatTime(range.end)}</span>
              </div>
            </div>
            <div className="tl-playhead" ref={playheadRef} data-testid="playhead" />
          </div>
        </div>
      </div>
    </div>
  )
}

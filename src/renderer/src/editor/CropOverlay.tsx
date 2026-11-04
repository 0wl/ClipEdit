import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import { dragCrop, moveCrop, type CropEdge, type CropRect } from '@shared/crop'

type DragKind = CropEdge | 'move'

const EDGES: CropEdge[] = ['n', 's', 'e', 'w']
const CORNERS: CropEdge[] = ['nw', 'ne', 'sw', 'se']

/**
 * Crop box drawn over the visible video picture (object-fit: contain). Coordinates
 * are source pixels (W x H); the area outside the crop is dimmed and desaturated.
 */
export default function CropOverlay(props: {
  W: number
  H: number
  aspect: number // displayed picture aspect (width / height)
  crop: CropRect
  editing: boolean
  ratio: number | null
  onChange: (r: CropRect) => void
}): ReactNode {
  const { W, H, aspect, crop, editing, ratio, onChange } = props
  const layerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [drag, setDrag] = useState<DragKind | null>(null)
  const start = useRef<{ kind: DragKind; x: number; y: number; r0: CropRect } | null>(null)

  // Where the picture actually sits inside the stage (letter/pillar-boxing).
  useEffect(() => {
    const el = layerRef.current
    if (!el) return
    const measure = (): void => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch || !aspect) return
      let width = cw
      let height = cw / aspect
      if (height > ch) {
        height = ch
        width = ch * aspect
      }
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  const begin = (kind: DragKind) => (e: RPointerEvent) => {
    if (!editing || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { kind, x: e.clientX, y: e.clientY, r0: crop }
    setDrag(kind)
  }

  const onMove = (e: RPointerEvent): void => {
    const s = start.current
    if (!s || !box.width || !box.height) return
    const dx = ((e.clientX - s.x) * W) / box.width
    const dy = ((e.clientY - s.y) * H) / box.height
    onChange(s.kind === 'move' ? moveCrop(s.r0, dx, dy, W, H) : dragCrop(s.r0, s.kind, dx, dy, W, H, ratio))
  }

  const end = (): void => {
    start.current = null
    setDrag(null)
  }

  const pct = (v: number, of: number): string => `${(v / of) * 100}%`
  const x = crop.x
  const y = crop.y
  const r = crop.x + crop.w
  const b = crop.y + crop.h

  return (
    <div
      ref={layerRef}
      className={`crop-layer${editing ? ' editing' : ''}`}
      onClick={(e) => editing && e.stopPropagation()}
      data-testid="crop-layer"
    >
      <div
        className="crop-content"
        style={box}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        data-testid="crop-content"
      >
        <div className="crop-dim" style={{ left: 0, top: 0, width: '100%', height: pct(y, H) }} />
        <div className="crop-dim" style={{ left: 0, top: pct(b, H), width: '100%', bottom: 0 }} />
        <div className="crop-dim" style={{ left: 0, top: pct(y, H), width: pct(x, W), height: pct(crop.h, H) }} />
        <div className="crop-dim" style={{ left: pct(r, W), top: pct(y, H), right: 0, height: pct(crop.h, H) }} />
        <div
          className={`crop-box${drag ? ' dragging' : ''}`}
          style={{ left: pct(x, W), top: pct(y, H), width: pct(crop.w, W), height: pct(crop.h, H) }}
          onPointerDown={begin('move')}
          data-testid="crop-box"
        >
          {editing && (
            <>
              <div className="crop-grid v1" />
              <div className="crop-grid v2" />
              <div className="crop-grid h1" />
              <div className="crop-grid h2" />
              {EDGES.map((ed) => (
                <div key={ed} className={`crop-edge ${ed}`} onPointerDown={begin(ed)} data-testid={`crop-edge-${ed}`}>
                  <span className="crop-bar" />
                </div>
              ))}
              {CORNERS.map((c) => (
                <div key={c} className={`crop-corner ${c}`} onPointerDown={begin(c)} data-testid={`crop-corner-${c}`} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

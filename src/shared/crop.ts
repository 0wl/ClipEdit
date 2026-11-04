// Pure crop-rectangle math, in source pixels (display orientation, rotation applied).

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type CropEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface AspectPreset {
  id: string
  label: string
  ratio: number | null // width / height; null = free
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Free crop', ratio: null },
  { id: '16:9', label: '16:9 Landscape', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 Vertical (Shorts, TikTok, Reels)', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 Square', ratio: 1 },
  { id: '4:3', label: '4:3 Classic', ratio: 4 / 3 }
]

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Smallest crop side, never more than the frame itself. */
export function minSide(W: number, H: number, min = 32): number {
  return Math.min(min, W, H)
}

export function fullCrop(W: number, H: number): CropRect {
  return { x: 0, y: 0, w: W, h: H }
}

export function isFullCrop(r: CropRect, W: number, H: number, eps = 1): boolean {
  return r.x <= eps && r.y <= eps && r.w >= W - eps && r.h >= H - eps
}

/** Largest rectangle of the given aspect ratio, centred in the frame. */
export function fitAspect(ratio: number, W: number, H: number): CropRect {
  let w = W
  let h = W / ratio
  if (h > H) {
    h = H
    w = H * ratio
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

export function clampCrop(r: CropRect, W: number, H: number, min = minSide(W, H)): CropRect {
  const w = clamp(r.w, min, W)
  const h = clamp(r.h, min, H)
  return { x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - h), w, h }
}

/** Move the whole crop by (dx, dy) source pixels, staying inside the frame. */
export function moveCrop(r: CropRect, dx: number, dy: number, W: number, H: number): CropRect {
  return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) }
}

/**
 * Drag an edge or corner by (dx, dy) source pixels from the starting rect r0.
 * Free mode moves only the dragged sides. With an aspect ratio, the opposite side
 * (corners) or the centre line (edges) stays anchored and the other dimension follows.
 */
export function dragCrop(
  r0: CropRect,
  edge: CropEdge,
  dx: number,
  dy: number,
  W: number,
  H: number,
  ratio: number | null,
  min = minSide(W, H)
): CropRect {
  const L0 = r0.x
  const T0 = r0.y
  const R0 = r0.x + r0.w
  const B0 = r0.y + r0.h

  if (ratio == null) {
    let L = L0
    let T = T0
    let R = R0
    let B = B0
    if (edge.includes('w')) L = clamp(L0 + dx, 0, R0 - min)
    if (edge.includes('e')) R = clamp(R0 + dx, L0 + min, W)
    if (edge.includes('n')) T = clamp(T0 + dy, 0, B0 - min)
    if (edge.includes('s')) B = clamp(B0 + dy, T0 + min, H)
    return { x: L, y: T, w: R - L, h: B - T }
  }

  const minW = Math.max(min, min * ratio)
  if (edge === 'e' || edge === 'w') {
    // Width follows the pointer; height follows the ratio around the vertical centre.
    const cy = (T0 + B0) / 2
    const anchorX = edge === 'e' ? L0 : R0
    const room = edge === 'e' ? W - anchorX : anchorX
    const maxW = Math.min(room, 2 * Math.min(cy, H - cy) * ratio)
    const w = clamp(r0.w + (edge === 'e' ? dx : -dx), Math.min(minW, maxW), maxW)
    const h = w / ratio
    return { x: edge === 'e' ? anchorX : anchorX - w, y: cy - h / 2, w, h }
  }
  if (edge === 'n' || edge === 's') {
    const cx = (L0 + R0) / 2
    const anchorY = edge === 's' ? T0 : B0
    const room = edge === 's' ? H - anchorY : anchorY
    const maxH = Math.min(room, (2 * Math.min(cx, W - cx)) / ratio)
    const h = clamp(r0.h + (edge === 's' ? dy : -dy), Math.min(minW / ratio, maxH), maxH)
    const w = h * ratio
    return { x: cx - w / 2, y: edge === 's' ? anchorY : anchorY - h, w, h }
  }
  // Corners: the opposite corner is the anchor; use whichever axis moved further.
  const east = edge.includes('e')
  const south = edge.includes('s')
  const ax = east ? L0 : R0
  const ay = south ? T0 : B0
  const wFromX = r0.w + (east ? dx : -dx)
  const wFromY = (r0.h + (south ? dy : -dy)) * ratio
  const maxW = Math.min(east ? W - ax : ax, (south ? H - ay : ay) * ratio)
  const wanted = Math.abs(dx) >= Math.abs(dy) * ratio ? wFromX : wFromY
  const w = clamp(wanted, Math.min(minW, maxW), maxW)
  const h = w / ratio
  return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h }
}

/** Integer, even-sized crop for encoding (H.264 4:2:0 needs even dimensions). */
export function evenCrop(r: CropRect, W: number, H: number): CropRect {
  const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)
  const w = Math.min(even(r.w), even(W))
  const h = Math.min(even(r.h), even(H))
  const x = clamp(Math.round(r.x / 2) * 2, 0, Math.max(0, Math.floor((W - w) / 2) * 2))
  const y = clamp(Math.round(r.y / 2) * 2, 0, Math.max(0, Math.floor((H - h) / 2) * 2))
  return { x, y, w, h }
}

/** "9:16" etc. when the crop matches a preset (within 1%), otherwise null. */
export function aspectLabel(w: number, h: number): string | null {
  const r = w / h
  const hit = ASPECT_PRESETS.find((p) => p.ratio && Math.abs(p.ratio - r) / p.ratio < 0.01)
  return hit ? hit.id : null
}

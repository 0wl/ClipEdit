// Pure selection math for the timeline's [ ] handles and draggable range.

export interface Range {
  start: number
  end: number
}

export const MIN_CLIP = 0.1 // seconds

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Smallest allowed clip, never more than the whole video. */
export function minLen(duration: number, min = MIN_CLIP): number {
  return Math.min(min, Math.max(0, duration))
}

export function fullRange(duration: number): Range {
  return { start: 0, end: Math.max(0, duration) }
}

/** Normalises any range into [0, duration], ordered, at least minLen long. */
export function clampRange(r: Range, duration: number, min = MIN_CLIP): Range {
  const ml = minLen(duration, min)
  let start = clamp(Math.min(r.start, r.end), 0, duration)
  let end = clamp(Math.max(r.start, r.end), 0, duration)
  if (end - start < ml) {
    end = Math.min(duration, start + ml)
    start = Math.max(0, end - ml)
  }
  return { start, end }
}

/** Move one handle to time t; it can't cross the other handle (keeps minLen gap). */
export function moveHandle(r: Range, which: 'start' | 'end', t: number, duration: number, min = MIN_CLIP): Range {
  const ml = minLen(duration, min)
  if (which === 'start') return { start: clamp(t, 0, Math.max(0, r.end - ml)), end: r.end }
  return { start: r.start, end: clamp(t, Math.min(duration, r.start + ml), duration) }
}

/** Shift the whole selection by delta seconds, preserving its length, clamped to the video. */
export function moveRange(r: Range, delta: number, duration: number): Range {
  const len = r.end - r.start
  const start = clamp(r.start + delta, 0, Math.max(0, duration - len))
  return { start, end: start + len }
}

/** Pixel x within a track of the given width -> seconds. */
export function timeFromX(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0
  return clamp((x / width) * duration, 0, duration)
}

export function isFullRange(r: Range, duration: number, eps = 0.001): boolean {
  return r.start <= eps && r.end >= duration - eps
}

/** Snap a time to the nearest frame boundary (used for frame stepping). */
export function snapToFrame(t: number, fps: number): number {
  if (!fps || fps <= 0) return t
  return Math.round(t * fps) / fps
}

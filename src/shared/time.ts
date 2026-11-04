const pad = (n: number, w = 2): string => String(Math.floor(n)).padStart(w, '0')

/**
 * Timecode for the timeline / transport.
 * 65.32 -> "1:05.32", 3723.5 -> "1:02:03.50"; withFraction=false -> "1:05".
 */
export function formatTime(sec: number, withFraction = true): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  // Round to centiseconds first so 59.999 doesn't render as "0:59.100".
  const cs = Math.round(sec * 100)
  const total = Math.floor(cs / 100)
  const frac = cs % 100
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  return withFraction ? `${base}.${pad(frac)}` : base
}

/** Human duration for lists / footer: "20s", "4m 05s", "1h 02m". */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0s'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${pad(m)}m`
  if (m > 0) return `${m}m ${pad(s)}s`
  return sec < 10 ? `${(Math.round(sec * 10) / 10).toString()}s` : `${s}s`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${units[i]}`
}

export function formatRelative(then: number, now = Date.now()): string {
  const d = Math.max(0, now - then) / 1000
  if (d < 45) return 'just now'
  if (d < 90) return '1 min ago'
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 5400) return '1 hour ago'
  if (d < 86400) return `${Math.round(d / 3600)} hours ago`
  if (d < 172800) return 'yesterday'
  if (d < 604800) return `${Math.round(d / 86400)} days ago`
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatFps(fps: number): string {
  if (!fps) return ''
  const r = Math.round(fps * 100) / 100
  return `${Number.isInteger(r) ? r : r.toFixed(2)} fps`
}

/** "C:\Users\me\Videos\Very\Long\Folder" -> "C:\Users\…\Long\Folder" */
export function middleTruncatePath(p: string, max = 48): string {
  if (p.length <= max) return p
  const parts = p.split(/([\\/])/)
  const sep = p.includes('\\') ? '\\' : '/'
  const segs = parts.filter((x) => x !== '\\' && x !== '/')
  if (segs.length <= 3) return p.slice(0, max - 1) + '…'
  let head = segs.slice(0, 2).join(sep)
  const tail: string[] = []
  for (let i = segs.length - 1; i >= 2; i--) {
    const cand = [segs[i], ...tail].join(sep)
    if (head.length + cand.length + 3 > max && tail.length > 0) break
    tail.unshift(segs[i])
  }
  return `${head}${sep}…${sep}${tail.join(sep)}`
}

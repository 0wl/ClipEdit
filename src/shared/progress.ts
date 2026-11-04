// Parser for `ffmpeg -progress pipe:1` output (key=value lines, blocks end with progress=...).

export interface ProgressUpdate {
  outTime: number // seconds encoded so far
  speed: number // realtime multiple (0 if unknown)
  done: boolean // progress=end
}

export class ProgressParser {
  private buf = ''
  private outTime = 0
  private speed = 0

  /** Feed a stdout chunk; returns one update per completed progress block. */
  push(chunk: string): ProgressUpdate[] {
    this.buf += chunk
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    const out: ProgressUpdate[] = []
    for (const line of lines) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      switch (key) {
        // Both are microseconds in modern ffmpeg (out_time_ms is misnamed).
        case 'out_time_us':
        case 'out_time_ms': {
          const us = Number(val)
          if (Number.isFinite(us) && us >= 0) this.outTime = us / 1e6
          break
        }
        case 'out_time': {
          // Fallback "HH:MM:SS.micro" when the numeric keys are N/A.
          const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(val)
          if (m) this.outTime = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          break
        }
        case 'speed': {
          const s = parseFloat(val)
          this.speed = Number.isFinite(s) ? s : 0
          break
        }
        case 'progress':
          out.push({ outTime: this.outTime, speed: this.speed, done: val === 'end' })
          break
      }
    }
    return out
  }
}

/** Fraction 0..1 for a given encoded time against the clip length. */
export function progressFraction(outTime: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, outTime / total))
}

/** Seconds remaining, from elapsed wall time and fraction done (null until meaningful). */
export function etaSeconds(elapsed: number, fraction: number): number | null {
  if (fraction <= 0.02 || elapsed < 0.5) return null
  return Math.max(0, (elapsed / fraction) * (1 - fraction))
}

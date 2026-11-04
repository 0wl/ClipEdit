import { describe, expect, it } from 'vitest'
import { formatTime, formatBytes, formatDuration, middleTruncatePath, formatFps } from '@shared/time'
import { clampRange, moveHandle, moveRange, timeFromX, isFullRange, snapToFrame, MIN_CLIP } from '@shared/trim'
import { ProgressParser, progressFraction, etaSeconds } from '@shared/progress'
import { buildExportArgs, buildProxyArgs, estimateSize, targetVideoBitrate, containerFromPath, AUDIO_BITRATE } from '@shared/ffargs'
import { decidePlayback, isVideoPath, stemOf, dirOf } from '@shared/formats'

describe('time formatting', () => {
  it('formats timecodes', () => {
    expect(formatTime(0)).toBe('0:00.00')
    expect(formatTime(65.32)).toBe('1:05.32')
    expect(formatTime(3723.5)).toBe('1:02:03.50')
    expect(formatTime(59.999)).toBe('1:00.00') // rounds, never "0:59.100"
    expect(formatTime(5.4, false)).toBe('0:05')
    expect(formatTime(NaN)).toBe('0:00.00')
    expect(formatTime(-3)).toBe('0:00.00')
  })
  it('formats durations and sizes', () => {
    expect(formatDuration(20)).toBe('20s')
    expect(formatDuration(4.25)).toBe('4.3s')
    expect(formatDuration(245)).toBe('4m 05s')
    expect(formatDuration(3720)).toBe('1h 02m')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(7_900_838)).toBe('7.53 MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB')
    expect(formatFps(29.97002997)).toBe('29.97 fps')
    expect(formatFps(30)).toBe('30 fps')
  })
  it('middle-truncates long paths', () => {
    const p = 'C:\\Users\\someone\\Videos\\Captures\\2026\\November\\Gameplay\\Highlights'
    const t = middleTruncatePath(p, 40)
    expect(t.length).toBeLessThanOrEqual(44)
    expect(t.startsWith('C:\\Users')).toBe(true)
    expect(t.endsWith('Highlights')).toBe(true)
    expect(t).toContain('…')
    expect(middleTruncatePath('C:\\short', 40)).toBe('C:\\short')
  })
})

describe('trim math', () => {
  const D = 20
  it('handles cannot cross and keep a minimum length', () => {
    const r = { start: 5, end: 10 }
    expect(moveHandle(r, 'start', 12, D)).toEqual({ start: 10 - MIN_CLIP, end: 10 })
    expect(moveHandle(r, 'end', 2, D)).toEqual({ start: 5, end: 5 + MIN_CLIP })
    expect(moveHandle(r, 'start', -4, D)).toEqual({ start: 0, end: 10 })
    expect(moveHandle(r, 'end', 99, D)).toEqual({ start: 5, end: 20 })
  })
  it('moves the whole range, clamped, preserving length', () => {
    const r = { start: 5, end: 10 }
    expect(moveRange(r, 3, D)).toEqual({ start: 8, end: 13 })
    expect(moveRange(r, 100, D)).toEqual({ start: 15, end: 20 })
    expect(moveRange(r, -100, D)).toEqual({ start: 0, end: 5 })
  })
  it('normalises arbitrary ranges', () => {
    expect(clampRange({ start: 12, end: 3 }, D)).toEqual({ start: 3, end: 12 })
    expect(clampRange({ start: -5, end: 50 }, D)).toEqual({ start: 0, end: 20 })
    const tiny = clampRange({ start: 19.99, end: 20 }, D)
    expect(tiny.end - tiny.start).toBeCloseTo(MIN_CLIP)
    expect(tiny.end).toBe(20)
    // A video shorter than the minimum clip is still selectable as a whole.
    expect(clampRange({ start: 0, end: 0.05 }, 0.05)).toEqual({ start: 0, end: 0.05 })
  })
  it('maps pixels to time and snaps frames', () => {
    expect(timeFromX(250, 1000, 20)).toBe(5)
    expect(timeFromX(-10, 1000, 20)).toBe(0)
    expect(timeFromX(2000, 1000, 20)).toBe(20)
    expect(isFullRange({ start: 0, end: 20 }, 20)).toBe(true)
    expect(isFullRange({ start: 0.5, end: 20 }, 20)).toBe(false)
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1)
  })
})

describe('ffmpeg progress parsing', () => {
  it('parses blocks split across chunks', () => {
    const p = new ProgressParser()
    expect(p.push('frame=10\nout_time_us=1500000\nspe')).toEqual([])
    const u = p.push('ed=2.5x\nprogress=continue\nout_time_ms=3000000\nspeed=N/A\nprogress=end\n')
    expect(u).toEqual([
      { outTime: 1.5, speed: 2.5, done: false },
      { outTime: 3, speed: 0, done: true }
    ])
  })
  it('falls back to out_time strings', () => {
    const p = new ProgressParser()
    expect(p.push('out_time_us=N/A\nout_time=00:01:02.500000\nprogress=continue\n')[0].outTime).toBeCloseTo(62.5)
  })
  it('computes fraction and eta', () => {
    expect(progressFraction(5, 10)).toBe(0.5)
    expect(progressFraction(15, 10)).toBe(1)
    expect(progressFraction(1, 0)).toBe(0)
    expect(etaSeconds(10, 0.5)).toBe(10)
    expect(etaSeconds(0.1, 0.5)).toBeNull()
  })
})

const info = {
  videoBitrate: 3_000_000, bitRate: 3_200_000, audioBitrate: 128_000, hasAudio: true,
  size: 8_000_000, duration: 20, videoCodec: 'h264'
}

describe('export arguments', () => {
  it('targets the source bitrate and estimates size', () => {
    expect(targetVideoBitrate(info)).toBe(3_000_000)
    expect(targetVideoBitrate({ ...info, videoBitrate: 0 })).toBe(3_200_000 - 128_000)
    expect(targetVideoBitrate({ ...info, videoBitrate: 0, bitRate: 0 })).toBe(Math.round(8_000_000 * 8 / 20 - 128_000))
    expect(targetVideoBitrate({ ...info, videoCodec: 'hevc' })).toBe(3_900_000)
    expect(targetVideoBitrate({ ...info, videoBitrate: 10 })).toBe(400_000)
    const est = estimateSize(info, 10)
    expect(est).toBeCloseTo(((3_000_000 + AUDIO_BITRATE) * 10) / 8 * 1.01 + 4096, -2)
  })
  const job = {
    input: 'C:\\in.mkv', output: 'C:\\out.mp4', start: 1.5, end: 6.25, videoBitrate: 3_000_000, hasAudio: true, container: 'mp4' as const
  }
  it('builds an accurate CPU trim', () => {
    const a = buildExportArgs({ ...job, encoder: 'libx264' })
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 6)).toEqual(['-ss', '1.500', '-i', 'C:\\in.mkv', '-t', '4.750'])
    expect(a).toContain('libx264')
    expect(a).not.toContain('-hwaccel')
    expect(a).toContain('+faststart')
    expect(a[a.indexOf('-b:v') + 1]).toBe('3000000')
    expect(a[a.indexOf('-maxrate') + 1]).toBe('4500000')
    expect(a.at(-1)).toBe('C:\\out.mp4')
    expect(a).toContain('pipe:1')
  })
  it('builds GPU variants', () => {
    const n = buildExportArgs({ ...job, encoder: 'h264_nvenc' })
    expect(n).toContain('h264_nvenc')
    expect(n.indexOf('-hwaccel')).toBeLessThan(n.indexOf('-i'))
    expect(buildExportArgs({ ...job, encoder: 'h264_amf' })).toContain('h264_amf')
    expect(buildExportArgs({ ...job, encoder: 'h264_qsv' })).toContain('h264_qsv')
  })
  it('omits audio + faststart when not applicable', () => {
    const a = buildExportArgs({ ...job, encoder: 'libx264', hasAudio: false, container: 'mkv' })
    expect(a).not.toContain('-c:a')
    expect(a).not.toContain('0:a:0?')
    expect(a).not.toContain('+faststart')
  })
  it('builds proxy args', () => {
    const copy = buildProxyArgs({ input: 'a.mkv', output: 'p.mp4', copyVideo: true, hasAudio: true, encoder: 'libx264' })
    expect(copy[copy.indexOf('-c:v') + 1]).toBe('copy')
    expect(copy[copy.indexOf('-c:a') + 1]).toBe('aac')
    const tx = buildProxyArgs({ input: 'a.avi', output: 'p.mp4', copyVideo: false, hasAudio: false, encoder: 'h264_nvenc' })
    expect(tx).toContain('h264_nvenc')
    expect(tx).not.toContain('-c:a')
  })
  it('picks the container from the file name', () => {
    expect(containerFromPath('x.MKV')).toBe('mkv')
    expect(containerFromPath('x.mov')).toBe('mov')
    expect(containerFromPath('x.mp4')).toBe('mp4')
    expect(containerFromPath('x')).toBe('mp4')
  })
})

describe('formats / playback decision', () => {
  const base = { formatName: 'mov,mp4,m4a,3gp,3g2,mj2', videoCodec: 'h264', pixFmt: 'yuv420p', audioCodec: 'aac', hasAudio: true }
  it('plays common files directly', () => {
    expect(decidePlayback(base).direct).toBe(true)
    expect(decidePlayback({ ...base, formatName: 'matroska,webm', videoCodec: 'vp9', audioCodec: 'opus' }).direct).toBe(true)
    expect(decidePlayback({ ...base, hasAudio: false, audioCodec: '' }).direct).toBe(true)
  })
  it('proxies what Chromium cannot play', () => {
    const ac3 = decidePlayback({ ...base, formatName: 'matroska,webm', audioCodec: 'ac3' })
    expect(ac3).toMatchObject({ direct: false, copyVideo: true })
    const avi = decidePlayback({ ...base, formatName: 'avi', videoCodec: 'mpeg4', audioCodec: 'mp3' })
    expect(avi).toMatchObject({ direct: false, copyVideo: false })
    const h10 = decidePlayback({ ...base, pixFmt: 'yuv420p10le' })
    expect(h10).toMatchObject({ direct: false, copyVideo: false })
    const ts = decidePlayback({ ...base, formatName: 'mpegts' })
    expect(ts).toMatchObject({ direct: false, copyVideo: true })
  })
  it('recognises video paths', () => {
    expect(isVideoPath('C:\\a\\b.MP4')).toBe(true)
    expect(isVideoPath('C:\\a\\b.txt')).toBe(false)
    expect(isVideoPath('C:\\a\\mp4')).toBe(false)
    expect(stemOf('C:\\v\\my.clip.mkv')).toBe('my.clip')
    expect(dirOf('C:\\v\\my.mkv')).toBe('C:\\v')
  })
})

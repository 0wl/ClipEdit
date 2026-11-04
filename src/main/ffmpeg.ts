import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baseName, type ProbeInfo } from '@shared/formats'
import { ProgressParser } from '@shared/progress'

function resourceDir(): string {
  // Packaged: <install>/resources/ffmpeg. Dev: <project>/resources/ffmpeg.
  return app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'resources', 'ffmpeg')
}
export const ffmpegPath = (): string => join(resourceDir(), 'ffmpeg.exe')
export const ffprobePath = (): string => join(resourceDir(), 'ffprobe.exe')

export function workDir(sub: string): string {
  const dir = join(tmpdir(), 'ClipEdit', sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

function run(bin: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', timeout: timeoutMs }, (err, stdout, stderr) => {
      const raw: unknown = err ? (err as { code?: unknown }).code : 0
      resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: stdout as Buffer, stderr: (stderr as Buffer).toString() })
    })
  })
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseRate(r: string | undefined): number {
  if (!r) return 0
  const [a, b] = r.split('/').map(Number)
  if (!b) return num(a)
  return a / b
}

interface FfStream {
  codec_type?: string
  codec_name?: string
  profile?: string
  pix_fmt?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  bit_rate?: string
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: Record<string, string>
  side_data_list?: { rotation?: number }[]
}

export async function probe(path: string): Promise<ProbeInfo> {
  const st = statSync(path)
  const { code, stdout, stderr } = await run(ffprobePath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path
  ])
  if (code !== 0) throw new Error(stderr.trim().split('\n').pop() || 'Could not read this file.')
  const j = JSON.parse(stdout.toString('utf8')) as { format?: Record<string, string>; streams?: FfStream[] }
  const streams = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = streams.find((s) => s.codec_type === 'audio')
  if (!v) throw new Error('This file has no video stream.')
  const fmt = j.format ?? {}
  let duration = num(fmt.duration) || num(v.duration)
  if (!duration) throw new Error('Could not determine the video length.')

  let width = num(v.width)
  let height = num(v.height)
  const rot = Math.abs(num(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate)) % 180
  if (rot === 90) [width, height] = [height, width]

  return {
    path,
    name: baseName(path),
    size: st.size,
    duration,
    bitRate: num(fmt.bit_rate),
    formatName: fmt.format_name ?? '',
    width,
    height,
    fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
    videoCodec: v.codec_name ?? '',
    videoProfile: v.profile ?? '',
    pixFmt: v.pix_fmt ?? '',
    videoBitrate: num(v.bit_rate) || num(v.tags?.BPS) || num(v.tags?.['BPS-eng']),
    audioCodec: a?.codec_name ?? '',
    audioBitrate: num(a?.bit_rate) || num(a?.tags?.BPS) || num(a?.tags?.['BPS-eng']),
    hasAudio: !!a,
    mtimeMs: st.mtimeMs
  }
}

let cachedVersion: string | null = null
export async function ffmpegVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion
  const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-version'])
  const m = /ffmpeg version (\S+)/.exec(stdout.toString())
  cachedVersion = m ? m[1].replace(/-essentials_build.*/, '').replace(/-www\.gyan\.dev/, '') : 'unknown'
  return cachedVersion
}

/** Grab one frame as a JPEG data URL (fast input seek). */
export async function frameDataUrl(path: string, time: number, height: number): Promise<string | null> {
  const { code, stdout } = await run(
    ffmpegPath(),
    [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', Math.max(0, time).toFixed(3), '-i', path,
      '-frames:v', '1', '-an', '-sn',
      '-vf', `scale=-2:${height}:flags=bilinear`,
      '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
    ],
    20_000
  )
  if (code !== 0 || stdout.length === 0) return null
  return `data:image/jpeg;base64,${stdout.toString('base64')}`
}

/** Evenly spaced thumbnails for the timeline filmstrip; limited parallelism. */
export async function filmstrip(path: string, duration: number, count: number, height: number): Promise<string[]> {
  const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration)
  const out: string[] = new Array(count).fill('')
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < count) {
      const i = next++
      out[i] = (await frameDataUrl(path, times[i], height)) ?? ''
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, count) }, worker))
  // A frame grab right at the end can fail on some files; reuse a neighbour.
  for (let i = 0; i < count; i++) if (!out[i]) out[i] = out[i - 1] || out.find(Boolean) || ''
  return out
}

export interface RunHandle {
  promise: Promise<{ code: number; log: string; canceled: boolean }>
  cancel(): void
}

/** Spawn ffmpeg with -progress pipe:1; reports encoded seconds via onProgress. */
export function runWithProgress(args: string[], onProgress: (outTime: number, speed: number) => void): RunHandle {
  const child: ChildProcess = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const parser = new ProgressParser()
  let log = ''
  let canceled = false
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (d: string) => {
    for (const u of parser.push(d)) onProgress(u.outTime, u.speed)
  })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (d: string) => {
    log = (log + d).slice(-8000)
  })
  const promise = new Promise<{ code: number; log: string; canceled: boolean }>((resolve) => {
    child.on('error', (e) => resolve({ code: -1, log: String(e), canceled }))
    child.on('close', (code) => resolve({ code: code ?? -1, log, canceled }))
  })
  return {
    promise,
    cancel() {
      canceled = true
      child.kill()
    }
  }
}

export function safeUnlink(p: string): void {
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* ignore */
  }
}

export function proxyPathFor(info: ProbeInfo, transcode: boolean): string {
  const h = createHash('sha1').update(`${info.path}|${info.size}|${info.mtimeMs}`).digest('hex').slice(0, 16)
  return join(workDir('proxies'), `${h}${transcode ? '-t' : ''}.mp4`)
}

/** Keep the proxy cache bounded: drop the oldest beyond `keep` files. */
export function pruneProxies(keep = 6): void {
  try {
    const dir = workDir('proxies')
    const files = readdirSync(dir)
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(keep)) rmSync(join(dir, f), { force: true })
  } catch {
    /* ignore */
  }
}

export function readSmall(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

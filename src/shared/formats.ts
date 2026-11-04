// Supported input formats and the "can Chromium play this directly?" decision.

export const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv',
  'mpg', 'mpeg', 'ts', 'm2ts', 'mts', '3gp', 'ogv'
] as const

export const EXPORT_CONTAINERS = ['mp4', 'mkv', 'mov'] as const
export type ExportContainer = (typeof EXPORT_CONTAINERS)[number]

export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function isVideoPath(path: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extOf(path))
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function stemOf(path: string): string {
  const b = baseName(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(0, i) : b
}

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i >= 0 ? path.slice(0, i) : ''
}

export interface ProbeInfo {
  path: string
  name: string
  size: number // bytes
  duration: number // seconds
  bitRate: number // overall, bits/s (0 if unknown)
  formatName: string // ffprobe format_name, e.g. "mov,mp4,m4a,3gp,3g2,mj2"
  width: number // display width (rotation applied)
  height: number
  fps: number
  videoCodec: string // '' if no video stream
  videoProfile: string
  pixFmt: string
  videoBitrate: number // 0 if unknown
  audioCodec: string // '' if no audio stream
  audioBitrate: number
  hasAudio: boolean
  mtimeMs: number
}

const PLAYABLE_CONTAINERS = ['mov', 'mp4', 'matroska', 'webm']
const PLAYABLE_VIDEO = ['h264', 'vp8', 'vp9', 'av1', 'hevc']
const PLAYABLE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac']

export interface Playability {
  direct: boolean // play the original file as-is
  copyVideo: boolean // if a proxy is needed, can the video stream be stream-copied?
  reason: string
}

/** Decide whether Chromium's <video> can play the file directly or needs a preview proxy. */
export function decidePlayback(info: Pick<ProbeInfo, 'formatName' | 'videoCodec' | 'pixFmt' | 'audioCodec' | 'hasAudio'>): Playability {
  const containerOk = info.formatName.split(',').some((f) => PLAYABLE_CONTAINERS.includes(f.trim()))
  // Chromium can't decode 10-bit / 4:2:2 / 4:4:4 H.264 (High10/High422/High444).
  const h264Exotic = info.videoCodec === 'h264' && !/^(yuv420p|yuvj420p|nv12)$/.test(info.pixFmt)
  const videoOk = PLAYABLE_VIDEO.includes(info.videoCodec) && !h264Exotic
  const audioOk = !info.hasAudio || PLAYABLE_AUDIO.includes(info.audioCodec)

  if (containerOk && videoOk && audioOk) return { direct: true, copyVideo: true, reason: '' }
  const reasons: string[] = []
  if (!containerOk) reasons.push('container')
  if (!videoOk) reasons.push(`video codec ${info.videoCodec || 'unknown'}`)
  if (!audioOk) reasons.push(`audio codec ${info.audioCodec}`)
  // HEVC is copied as-is only if it plays; when it needs a proxy, transcode to be safe.
  const copyVideo = videoOk && info.videoCodec !== 'hevc'
  return { direct: false, copyVideo, reason: reasons.join(', ') }
}

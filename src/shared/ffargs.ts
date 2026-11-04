// FFmpeg argument builders + bitrate / size estimation (pure, unit-tested).
import type { ExportContainer, ProbeInfo } from './formats'

export type EncoderId = 'libx264' | 'h264_nvenc' | 'h264_amf' | 'h264_qsv'

export const ENCODER_LABELS: Record<EncoderId, string> = {
  libx264: 'x264',
  h264_nvenc: 'NVIDIA NVENC',
  h264_amf: 'AMD AMF',
  h264_qsv: 'Intel Quick Sync'
}

export const GPU_ENCODERS: EncoderId[] = ['h264_nvenc', 'h264_amf', 'h264_qsv']

export const AUDIO_BITRATE = 192_000
const MIN_VIDEO_BITRATE = 400_000
const MAX_VIDEO_BITRATE = 120_000_000

type BitrateInput = Pick<ProbeInfo, 'videoBitrate' | 'bitRate' | 'audioBitrate' | 'hasAudio' | 'size' | 'duration' | 'videoCodec'>

/**
 * Target video bitrate for the H.264 export: match the source so quality and size
 * stay comparable (and the size estimate is accurate). More efficient source codecs
 * get a bump because H.264 needs more bits for the same quality.
 */
export function targetVideoBitrate(info: BitrateInput): number {
  const audio = info.hasAudio ? info.audioBitrate || AUDIO_BITRATE : 0
  let base = info.videoBitrate
  if (!base && info.bitRate) base = info.bitRate - audio
  if (!base && info.size && info.duration) base = (info.size * 8) / info.duration - audio
  if (!base || !Number.isFinite(base)) base = 8_000_000
  if (['hevc', 'vp9', 'av1'].includes(info.videoCodec)) base *= 1.3
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, base)))
}

/** Estimated output size in bytes for a clip of `length` seconds. */
export function estimateSize(info: BitrateInput, length: number): number {
  const total = targetVideoBitrate(info) + (info.hasAudio ? AUDIO_BITRATE : 0)
  return Math.round(((total * Math.max(0, length)) / 8) * 1.01 + 4096)
}

export interface ExportJob {
  input: string
  output: string
  start: number
  end: number
  encoder: EncoderId
  videoBitrate: number
  hasAudio: boolean
  container: ExportContainer
}

const sec = (n: number): string => n.toFixed(3)

/** Arguments for an accurate (re-encoded) trim. */
export function buildExportArgs(job: ExportJob): string[] {
  const len = Math.max(0, job.end - job.start)
  const b = job.videoBitrate
  const gpu = job.encoder !== 'libx264'
  const args: string[] = ['-hide_banner', '-nostdin', '-y']
  // Hardware decode only alongside a hardware encoder; frames come back to system
  // memory so filters/pix_fmt conversion still work, and ffmpeg falls back to
  // software decoding by itself if the hwaccel can't handle the stream.
  if (gpu) args.push('-hwaccel', 'auto')
  args.push('-ss', sec(job.start), '-i', job.input, '-t', sec(len))
  args.push('-map', '0:v:0')
  if (job.hasAudio) args.push('-map', '0:a:0?')
  args.push('-map_metadata', '0', '-map_chapters', '-1', '-sn', '-dn')

  const rate = ['-b:v', String(b), '-maxrate', String(Math.round(b * 1.5)), '-bufsize', String(Math.round(b * 2))]
  switch (job.encoder) {
    case 'libx264':
      args.push('-c:v', 'libx264', '-preset', 'medium', ...rate)
      break
    case 'h264_nvenc':
      args.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', ...rate, '-profile:v', 'high')
      break
    case 'h264_amf':
      args.push('-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'vbr_peak', ...rate)
      break
    case 'h264_qsv':
      args.push('-c:v', 'h264_qsv', '-preset', 'medium', ...rate)
      break
  }
  args.push('-pix_fmt', 'yuv420p')
  if (job.hasAudio) args.push('-c:a', 'aac', '-b:a', String(AUDIO_BITRATE))
  if (job.container === 'mp4' || job.container === 'mov') args.push('-movflags', '+faststart')
  args.push('-progress', 'pipe:1', '-nostats', '-loglevel', 'error', job.output)
  return args
}

export interface ProxyJob {
  input: string
  output: string
  copyVideo: boolean
  hasAudio: boolean
  encoder: EncoderId // used only when the video must be transcoded
}

/** Arguments for a quick preview proxy that Chromium can always play. */
export function buildProxyArgs(job: ProxyJob): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-i', job.input, '-map', '0:v:0']
  if (job.hasAudio) args.push('-map', '0:a:0?')
  args.push('-sn', '-dn')
  if (job.copyVideo) {
    args.push('-c:v', 'copy')
  } else {
    // Small GOP so scrubbing the proxy is snappy; cap at 1080p for speed.
    args.push('-vf', "scale='min(1920,iw)':-2:flags=fast_bilinear", '-pix_fmt', 'yuv420p', '-g', '15')
    if (job.encoder === 'h264_nvenc') args.push('-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'constqp', '-qp', '23')
    else if (job.encoder === 'h264_amf') args.push('-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23')
    else if (job.encoder === 'h264_qsv') args.push('-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23')
    else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23')
  }
  if (job.hasAudio) args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2')
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error', job.output)
  return args
}

/** Pick an output container from a save-dialog path (defaults to mp4). */
export function containerFromPath(path: string): ExportContainer {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'mkv' ? 'mkv' : ext === 'mov' ? 'mov' : 'mp4'
}

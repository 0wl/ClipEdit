import { execFile } from 'node:child_process'
import { ENCODER_LABELS, GPU_ENCODERS, type EncoderId } from '@shared/ffargs'
import type { EncoderInfo } from '@shared/api'
import { ffmpegPath } from './ffmpeg'

let detected: EncoderInfo['gpu'] = null
let detection: Promise<EncoderInfo['gpu']> | null = null
let done = false

function tryEncoder(id: EncoderId): Promise<boolean> {
  return new Promise((resolve) => {
    // A tiny real encode: listing encoders isn't enough, the driver/GPU must accept it.
    execFile(
      ffmpegPath(),
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-pix_fmt', 'yuv420p', '-c:v', id, '-f', 'null', '-'],
      { windowsHide: true, timeout: 15_000 },
      (err) => resolve(!err)
    )
  })
}

/** Probe GPU encoders once (NVENC -> AMF -> QSV); result is cached for the session. */
export function detectGpuEncoder(): Promise<EncoderInfo['gpu']> {
  if (!detection) {
    detection = (async () => {
      for (const id of GPU_ENCODERS) {
        if (await tryEncoder(id)) {
          detected = { id, label: ENCODER_LABELS[id] }
          break
        }
      }
      done = true
      return detected
    })()
  }
  return detection
}

export function encoderInfo(): EncoderInfo {
  return { gpu: detected, detecting: !done }
}

// Generates small test videos in tests/fixtures using the bundled FFmpeg.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ff = join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
const out = join(root, 'tests', 'fixtures')
mkdirSync(out, { recursive: true })

const src = (secs, size = '1280x720', rate = 30) => [
  '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${secs}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${secs}`
]

const fixtures = {
  'sample.mp4': [...src(20), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3M', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  'sample_ac3.mkv': [...src(12), '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2M', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-b:a', '192k'],
  'sample.avi': [...src(12, '640x360'), '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '128k'],
  'sample.webm': [...src(10, '640x360'), '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', '-b:a', '96k'],
  'sample_hevc.mp4': [...src(10), '-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', '2M', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac'],
  'long_1080p.mp4': [...src(90, '1920x1080'), '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6M', '-g', '120', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
}

for (const [name, args] of Object.entries(fixtures)) {
  const p = join(out, name)
  if (existsSync(p) && !process.argv.includes('--force')) {
    console.log(`= ${name}`)
    continue
  }
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args, p], { stdio: 'inherit' })
  console.log(`+ ${name}`)
}

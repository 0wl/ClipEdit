// Downloads a Windows FFmpeg build (gyan.dev "release essentials", includes
// NVENC / AMF / QSV encoders) and copies ffmpeg.exe + ffprobe.exe into
// resources/ffmpeg/. Run once: `npm run fetch-ffmpeg`.
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

// Pinned to FFmpeg 7.1.1: its NVENC headers (API 12.x) work with NVIDIA drivers
// from ~531 upward. FFmpeg 9.x needs API 13.1 (driver 610+), which would make
// GPU export silently unavailable on many machines.
const URL =
  process.env.CLIPEDIT_FFMPEG_URL ||
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'ffmpeg')

if (!process.argv.includes('--force') && existsSync(join(outDir, 'ffmpeg.exe')) && existsSync(join(outDir, 'ffprobe.exe'))) {
  console.log('FFmpeg already present in resources/ffmpeg (use --force to re-download).')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'clipedit-ffmpeg-'))
const zipPath = join(work, 'ffmpeg.zip')
const extractDir = join(work, 'x')
mkdirSync(extractDir)

console.log(`Downloading ${URL} ...`)
const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))
console.log(`Downloaded ${(statSync(zipPath).size / 1048576).toFixed(1)} MB, extracting...`)

// Windows 10+ ships bsdtar, which extracts zip archives. Use it explicitly so a
// GNU tar from Git Bash on PATH (which can't read zips / "C:" paths) isn't picked.
const sysTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
execFileSync(existsSync(sysTar) ? sysTar : 'tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' })

function find(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const r = find(p, name)
      if (r) return r
    } else if (e.name.toLowerCase() === name) return p
  }
  return null
}

mkdirSync(outDir, { recursive: true })
for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
  const src = find(extractDir, exe)
  if (!src) throw new Error(`${exe} not found in archive`)
  copyFileSync(src, join(outDir, exe))
  console.log(`  -> resources/ffmpeg/${exe}`)
}
rmSync(work, { recursive: true, force: true })
console.log('FFmpeg ready.')

// clipedit-media:// — serves local video files to <video> with HTTP Range support,
// so seeking in large files is instant. Only files the app explicitly opened
// (or generated as proxies) are served.
import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extOf } from '@shared/formats'

export const MEDIA_SCHEME = 'clipedit-media'

const allowed = new Set<string>()
const key = (p: string): string => p.toLowerCase()

export function allowMedia(path: string): string {
  allowed.add(key(path))
  return `${MEDIA_SCHEME}://media/${encodeURIComponent(path)}`
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska'
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!allowed.has(key(path))) return new Response('Forbidden', { status: 403 })
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const type = MIME[extOf(path)] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (!m) {
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
      })
    }
    let start = m[1] ? Number(m[1]) : NaN
    let end = m[2] ? Number(m[2]) : size - 1
    if (Number.isNaN(start)) {
      // suffix range: last N bytes
      start = Math.max(0, size - end)
      end = size - 1
    }
    end = Math.min(end, size - 1)
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  })
}

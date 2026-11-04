import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..', '..')
export const FIX = join(ROOT, 'tests', 'fixtures')
export const fixture = (name: string): string => join(FIX, name)
export const FFPROBE = join(ROOT, 'resources', 'ffmpeg', 'ffprobe.exe')

export function tempDir(prefix = 'clipedit-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
}

export async function launch(opts: { file?: string; userData?: string; env?: Record<string, string> } = {}): Promise<Launched> {
  const userData = opts.userData ?? tempDir()
  const app = await electron.launch({
    args: ['.', ...(opts.file ? [opts.file] : [])],
    cwd: ROOT,
    env: { ...process.env, CLIPEDIT_USER_DATA: userData, ...opts.env } as Record<string, string>
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userData }
}

/** Point the stubbed open/save dialogs (read by the main process per call) at a path. */
export async function stubDialogs(app: ElectronApplication, v: { open?: string; save?: string }): Promise<void> {
  await app.evaluate((_e, v) => {
    if (v.open !== undefined) process.env.CLIPEDIT_TEST_OPEN = v.open
    if (v.save !== undefined) process.env.CLIPEDIT_TEST_SAVE = v.save
  }, v)
}

export async function waitForVideo(page: Page): Promise<void> {
  await expect(page.getByTestId('view-editor')).toBeVisible()
  await page.waitForFunction(() => {
    const v = document.querySelector('video')
    return !!v && v.readyState >= 2 && v.videoWidth > 0
  }, undefined, { timeout: 60_000 })
}

export async function seekTo(page: Page, t: number): Promise<void> {
  await page.evaluate(
    (t) =>
      new Promise<void>((res) => {
        const v = document.querySelector('video')!
        if (Math.abs(v.currentTime - t) < 0.001) return res()
        v.addEventListener('seeked', () => res(), { once: true })
        v.currentTime = t
      }),
    t
  )
}

export const videoTime = (page: Page): Promise<number> => page.evaluate(() => document.querySelector('video')!.currentTime)

/** "1:05.32" -> 65.32 */
export function parseTimecode(s: string): number {
  const parts = s.trim().split(':').map(Number)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export async function chipTime(page: Page, id: 'chip-in' | 'chip-out' | 'chip-len'): Promise<number> {
  const txt = (await page.getByTestId(id).innerText()).replace(/^(In|Out|Length)\s*/, '')
  return parseTimecode(txt)
}

export function ffprobe(path: string): { duration: number; encoder: string; vcodec: string; acodec: string; size: number } {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]).toString()
  const j = JSON.parse(out)
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  const a = j.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
  return {
    duration: Number(j.format.duration),
    // mp4 writes "encoder", Matroska "ENCODER"
    encoder: Object.entries((v?.tags ?? {}) as Record<string, string>).find(([k]) => k.toLowerCase() === 'encoder')?.[1] ?? '',
    vcodec: v?.codec_name ?? '',
    acodec: a?.codec_name ?? '',
    size: Number(j.format.size)
  }
}

/** Drag from one point to another with intermediate pointer moves. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

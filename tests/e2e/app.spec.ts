import { test, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROOT, launch, stubDialogs, waitForVideo, seekTo, videoTime, chipTime, ffprobe, drag, fixture, tempDir, parseTimecode
} from './helpers'

const SAMPLE = fixture('sample.mp4') // 20s, 1280x720, h264+aac

test.describe('home & opening', () => {
  test('empty home, open via the Open button, footer details, recent list', async () => {
    const { app, page } = await launch()
    await expect(page.getByTestId('view-home')).toBeVisible()
    await expect(page.getByTestId('home-empty')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recently opened' })).toBeVisible()

    await stubDialogs(app, { open: SAMPLE })
    await page.getByTestId('nav-open').click()
    await waitForVideo(page)

    await expect(page.getByTestId('footer-title')).toHaveText('sample.mp4')
    await expect(page.getByTestId('footer-size')).toContainText('7.53 MB')
    await expect(page.getByTestId('footer-length')).toContainText('20s')
    await expect(page.getByTestId('statusbar')).toContainText('1280×720')
    await expect(page.getByTestId('statusbar')).toContainText('30 fps')
    await expect(page.getByTestId('statusbar')).toContainText('H.264 / AAC')
    // Default selection is the whole video.
    expect(await chipTime(page, 'chip-in')).toBe(0)
    expect(await chipTime(page, 'chip-out')).toBeCloseTo(20, 1)

    // Close returns home, and the video is in "Recently opened" with a thumbnail.
    await page.getByTestId('ed-close').click()
    await expect(page.getByTestId('recent-row')).toHaveCount(1)
    await expect(page.getByTestId('recent-row')).toContainText('sample.mp4')
    await expect(page.getByTestId('nav-recent').locator('.badge')).toHaveText('1')
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('nav-recent').click()
    await expect(page.locator('.recent-thumb img')).toHaveCount(1)

    // Clicking the row reopens it.
    await page.getByTestId('recent-row').click()
    await waitForVideo(page)
    await app.close()
  })

  test('file passed on the command line opens straight into the editor', async () => {
    const { app, page } = await launch({ file: SAMPLE })
    await waitForVideo(page)
    await expect(page.getByTestId('footer-title')).toHaveText('sample.mp4')
    await app.close()
  })

  test('a second launch with a file reuses the running window', async () => {
    const { app, page, userData } = await launch()
    await expect(page.getByTestId('view-home')).toBeVisible()
    const electronExe = await app.evaluate(() => process.execPath)
    const second = spawn(electronExe, ['.', fixture('sample.webm')], {
      cwd: ROOT,
      env: { ...process.env, CLIPEDIT_USER_DATA: userData }
    })
    const exited = new Promise<number | null>((r) => second.on('exit', (c) => r(c)))
    await waitForVideo(page)
    await expect(page.getByTestId('footer-title')).toHaveText('sample.webm')
    expect(await exited).toBe(0) // second instance quit after handing the file over
    expect(app.windows().length).toBe(1)
    await app.close()
  })

  test('recent list persists, can remove entries, and flags missing files', async () => {
    const dir = tempDir()
    const copy = join(dir, 'gone.mp4')
    copyFileSync(SAMPLE, copy)
    const first = await launch({ file: copy })
    await waitForVideo(first.page)
    await first.app.close()
    unlinkSync(copy)

    const second = await launch({ userData: first.userData })
    const row = second.page.getByTestId('recent-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('File not found')
    await row.click()
    await expect(second.page.getByTestId('toast')).toContainText('File not found')
    // Missing file: copy/delete disabled, folder + remove still available.
    await expect(row.getByTestId('row-copy')).toBeDisabled()
    await expect(row.getByTestId('row-delete')).toBeDisabled()
    await row.click({ button: 'right' })
    await expect(second.page.getByTestId('ctx-copy')).toBeDisabled()
    await expect(second.page.getByTestId('ctx-delete')).toBeDisabled()
    await second.page.getByTestId('ctx-remove').click()
    await expect(second.page.getByTestId('home-empty')).toBeVisible()
    await second.app.close()
  })

  test('recent row: length badge, icon buttons with tooltips, right-click menu, delete', async () => {
    const dir = tempDir()
    const copy = join(dir, 'row test.mp4')
    copyFileSync(SAMPLE, copy)
    const first = await launch({ file: copy })
    await waitForVideo(first.page)
    await first.app.close()

    const { app, page } = await launch({ userData: first.userData })
    // Record shell actions instead of opening Explorer / filling the Recycle Bin.
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __shell: string[] }
      g.__shell = []
      shell.showItemInFolder = (p: string) => void g.__shell.push(`folder:${p}`)
      shell.trashItem = async (p: string) => void g.__shell.push(`trash:${p}`)
    })
    const shellLog = (): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { __shell: string[] }).__shell)
    const row = page.getByTestId('recent-row')
    await expect(row).toHaveCount(1)

    // Length badge bottom-left of the thumbnail.
    const badge = row.getByTestId('recent-dur')
    await expect(badge).toHaveText('0:20')
    const tb = (await row.locator('.recent-thumb').boundingBox())!
    const bb = (await badge.boundingBox())!
    expect(bb.x - tb.x).toBeLessThan(10)
    expect(tb.y + tb.height - (bb.y + bb.height)).toBeLessThan(10)

    // Icon-only buttons with hover tooltips.
    await expect(row.getByTestId('row-copy')).toHaveText('')
    await row.getByTestId('row-copy').hover()
    await expect(row.locator('.tip-wrap:has([data-testid=row-copy]) .tip')).toHaveCSS('opacity', '1')
    await expect(row.locator('.tip-wrap:has([data-testid=row-copy]) .tip')).toContainText('Copy file')

    // Copy puts the file itself on the clipboard.
    await row.getByTestId('row-copy').click()
    await expect(page.getByTestId('toast')).toContainText('Copied row test.mp4')
    const clip = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', '(Get-Clipboard -Format FileDropList).FullName']).toString().trim()
    expect(clip).toBe(copy)
    await expect(page.getByTestId('view-home')).toBeVisible() // button click didn't open the editor

    await row.getByTestId('row-folder').click()
    await expect.poll(shellLog).toContain(`folder:${copy}`)

    // Right-click menu: labelled items, Copy path, Escape closes.
    await row.click({ button: 'right' })
    const menu = page.getByTestId('ctx-menu')
    await expect(menu).toBeVisible()
    for (const label of ['Open in editor', 'Copy', 'Copy path', 'Open folder', 'Remove from list', 'Delete']) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    }
    await page.getByTestId('ctx-copy-path').click()
    await expect(menu).toHaveCount(0)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(copy)
    await row.click({ button: 'right' })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // Delete: confirm dialog (Cancel focused), cancel keeps it, confirm trashes + removes.
    await row.getByTestId('row-delete').click()
    const confirm = page.getByTestId('delete-confirm')
    await expect(confirm).toContainText('row test.mp4')
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(row).toHaveCount(1)
    await row.click({ button: 'right' })
    await page.getByTestId('ctx-delete').click()
    await page.getByTestId('confirm-delete').click()
    await expect(page.getByTestId('home-empty')).toBeVisible()
    expect(await shellLog()).toContain(`trash:${copy}`)
    await expect(page.getByTestId('toast')).toContainText('Recycle Bin')

    // Right-click "Open in editor" works too (re-add by opening).
    await stubDialogs(app, { open: SAMPLE })
    await page.getByTestId('home-open').click()
    await waitForVideo(page)
    await page.getByTestId('ed-close').click()
    await page.getByTestId('recent-row').first().click({ button: 'right' })
    await page.getByTestId('ctx-open').click()
    await waitForVideo(page)
    await app.close()
  })
})

test.describe('playback & timeline', () => {
  test('play/pause toggles icon and plays; skip moves 5s', async () => {
    const { app, page } = await launch({ file: SAMPLE })
    await waitForVideo(page)
    const play = page.getByTestId('play-toggle')
    await expect(play).toHaveAttribute('data-state', 'paused')
    await play.click()
    await expect(play).toHaveAttribute('data-state', 'playing')
    await expect(play).toHaveAttribute('aria-label', 'Pause')
    await page.waitForTimeout(700)
    expect(await videoTime(page)).toBeGreaterThan(0.3)
    await play.click()
    await expect(play).toHaveAttribute('data-state', 'paused')

    await seekTo(page, 2)
    await page.getByTestId('skip-fwd').click()
    await expect.poll(() => videoTime(page)).toBeCloseTo(7, 1)
    await page.getByTestId('skip-back').click()
    await expect.poll(() => videoTime(page)).toBeCloseTo(2, 1)
    await page.getByTestId('skip-back').click()
    await expect.poll(() => videoTime(page)).toBe(0) // clamped at start

    // Keyboard: Space toggles, arrows skip.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => videoTime(page)).toBeCloseTo(5, 1)
    await page.keyboard.press('Space')
    await expect(play).toHaveAttribute('data-state', 'playing')
    await page.keyboard.press('Space')
    await expect(play).toHaveAttribute('data-state', 'paused')
    // Current time display follows the video.
    await seekTo(page, 12.5)
    await expect(page.getByTestId('time-current')).toHaveText('0:12.50')

    // After clicking a skip button (which keeps focus), Space still means play/pause.
    await page.getByTestId('skip-back').click()
    await expect.poll(() => videoTime(page)).toBeCloseTo(7.5, 1)
    await page.keyboard.press('Space')
    await expect(play).toHaveAttribute('data-state', 'playing')
    await page.waitForTimeout(500)
    await page.keyboard.press('Space')
    await expect(play).toHaveAttribute('data-state', 'paused')
    expect(await videoTime(page)).toBeGreaterThan(7.6)

    // Arrow keys on the focused volume slider change volume, not the playhead.
    const before = await videoTime(page)
    await page.getByLabel('Volume').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await videoTime(page)).toBeCloseTo(before, 2)
    expect(await page.evaluate(() => document.querySelector('video')!.volume)).toBeLessThan(1)

    // Window title names the open file.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('sample.mp4 — ClipEdit')
    await app.close()
  })

  test('drag [ and ] handles, move the selection, scrub, reset', async () => {
    const { app, page } = await launch({ file: SAMPLE })
    await waitForVideo(page)
    const track = (await page.getByTestId('tl-track').boundingBox())!
    const y = track.y + track.height / 2
    const xAt = (t: number): number => track.x + (t / 20) * track.width

    // Start handle: grab its bracket (just left of the track edge) and drag to 5s.
    const hs = (await page.getByTestId('handle-start').boundingBox())!
    await drag(page, { x: hs.x + hs.width / 2 - 2, y }, { x: xAt(5) - 4, y })
    expect(await chipTime(page, 'chip-in')).toBeCloseTo(5, 0)
    // The video previews the handle position while dragging.
    expect(await videoTime(page)).toBeCloseTo(await chipTime(page, 'chip-in'), 1)

    const he = (await page.getByTestId('handle-end').boundingBox())!
    await drag(page, { x: he.x + he.width / 2 + 2, y }, { x: xAt(15) + 4, y })
    expect(await chipTime(page, 'chip-out')).toBeCloseTo(15, 0)
    const len = await chipTime(page, 'chip-len')
    expect(len).toBeCloseTo((await chipTime(page, 'chip-out')) - (await chipTime(page, 'chip-in')), 1)

    // Handles can't cross: drag start far past the end.
    const hs2 = (await page.getByTestId('handle-start').boundingBox())!
    await drag(page, { x: hs2.x + hs2.width / 2, y }, { x: xAt(19), y })
    const inAfter = await chipTime(page, 'chip-in')
    const outAfter = await chipTime(page, 'chip-out')
    expect(inAfter).toBeLessThan(outAfter)
    expect(outAfter - inAfter).toBeCloseTo(0.1, 1)

    // Reset, then make a 5..10 selection and move it by +4s keeping its length.
    await page.getByTestId('reset-range').click()
    expect(await chipTime(page, 'chip-len')).toBeCloseTo(20, 1)
    await seekTo(page, 5)
    await page.keyboard.press('i')
    await seekTo(page, 10)
    await page.keyboard.press('o')
    expect(await chipTime(page, 'chip-in')).toBeCloseTo(5, 2)
    expect(await chipTime(page, 'chip-out')).toBeCloseTo(10, 2)
    await drag(page, { x: xAt(7.5), y }, { x: xAt(11.5), y })
    expect(await chipTime(page, 'chip-in')).toBeCloseTo(9, 0)
    expect(await chipTime(page, 'chip-len')).toBeCloseTo(5, 1)
    // Dragging way past the end clamps the selection to the video.
    await drag(page, { x: xAt(11.5), y }, { x: track.x + track.width + 200, y })
    expect(await chipTime(page, 'chip-out')).toBeCloseTo(20, 1)
    expect(await chipTime(page, 'chip-len')).toBeCloseTo(5, 1)

    // Clicking the track outside the selection scrubs the video there.
    await page.mouse.click(xAt(3), y)
    await expect.poll(() => videoTime(page)).toBeCloseTo(3, 0)
    // Clicking the ruler scrubs too.
    const ruler = (await page.locator('.tl-ruler').boundingBox())!
    await page.mouse.click(xAt(6), ruler.y + ruler.height / 2)
    await expect.poll(() => videoTime(page)).toBeCloseTo(6, 0)
    await app.close()
  })
})

test.describe('crop', () => {
  test('crop toolbar, edge drag, aspect preset, move, export at cropped size', async () => {
    const { app, page, userData } = await launch({ file: SAMPLE })
    await waitForVideo(page)
    await page.evaluate(() => window.clipedit.setSettings({ gpu: false }))
    await app.close()
    const l = await launch({ file: SAMPLE, userData })
    const p = l.page
    await waitForVideo(p)

    // Toolbar is right-aligned above the video.
    const tb = (await p.getByTestId('toolbar').boundingBox())!
    const stage = (await p.getByTestId('stage').boundingBox())!
    expect(Math.abs(tb.x + tb.width - (stage.x + stage.width))).toBeLessThan(3)
    expect(tb.y + tb.height).toBeLessThan(stage.y)
    // Icon-only button with a hover label.
    const toggle = p.getByTestId('crop-toggle')
    await expect(toggle).toHaveText('')
    await toggle.hover()
    await expect(p.locator('.tip-wrap:has([data-testid=crop-toggle]) .tip')).toHaveCSS('opacity', '1')
    await expect(p.locator('.tip-wrap:has([data-testid=crop-toggle]) .tip')).toContainText('Crop')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(p.getByTestId('aspect-9:16')).toBeVisible()
    await expect(p.getByTestId('crop-size')).toHaveCount(0) // full frame = no crop yet

    // Drag the left slider a quarter of the way in.
    const content = (await p.getByTestId('crop-content').boundingBox())!
    const w = (await p.getByTestId('crop-edge-w').boundingBox())!
    await drag(p, { x: w.x + w.width / 2, y: w.y + w.height / 2 }, { x: w.x + w.width / 2 + content.width / 4, y: w.y + w.height / 2 })
    const size1 = await p.getByTestId('crop-size').innerText()
    const [cw, ch] = size1.match(/(\d+)×(\d+)/)!.slice(1).map(Number)
    expect(cw).toBeGreaterThan(940)
    expect(cw).toBeLessThan(980)
    expect(ch).toBe(720)
    // Outside the crop is dimmed + desaturated.
    expect(await p.locator('.crop-dim').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('grayscale')

    // 9:16 preset, then slide the box sideways; size stays 404x720.
    await p.getByTestId('aspect-9:16').click()
    await expect(p.getByTestId('aspect-9:16')).toHaveAttribute('aria-pressed', 'true')
    await expect(p.getByTestId('crop-size')).toContainText('404×720')
    await expect(p.getByTestId('crop-size')).toContainText('9:16')
    const box = (await p.getByTestId('crop-box').boundingBox())!
    await drag(p, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 - 150, y: box.y + box.height / 2 })
    const moved = (await p.getByTestId('crop-box').boundingBox())!
    expect(moved.x).toBeLessThan(box.x - 100)
    await expect(p.getByTestId('crop-size')).toContainText('404×720')

    // Enter finishes cropping; the crop stays visible and clicks play the video again.
    await p.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(p.getByTestId('crop-edge-w')).toHaveCount(0)
    await expect(p.getByTestId('crop-box')).toBeVisible()
    await p.getByTestId('stage').click()
    await expect(p.getByTestId('play-toggle')).toHaveAttribute('data-state', 'playing')
    await p.getByTestId('stage').click()

    // Export a 4s range: confirmation shows the crop, output has the cropped size.
    const out = join(tempDir(), 'cropped.mp4')
    await stubDialogs(l.app, { save: out })
    await seekTo(p, 2)
    await p.keyboard.press('i')
    await seekTo(p, 6)
    await p.keyboard.press('o')
    await p.keyboard.press('Control+e')
    await expect(p.getByTestId('confirm-crop')).toContainText('404×720')
    await p.getByTestId('confirm-export').click()
    await expect(p.getByTestId('export-done')).toBeVisible({ timeout: 60_000 })
    const dims = execFileSync(join(ROOT, 'resources', 'ffmpeg', 'ffprobe.exe'), [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out
    ]).toString().trim()
    expect(dims).toBe('404,720')
    expect(ffprobe(out).duration).toBeCloseTo(4, 0)
    await p.getByTestId('export-done-ok').click()

    // Reset removes the crop.
    await p.keyboard.press('c')
    await p.getByTestId('crop-reset').click()
    await expect(p.getByTestId('crop-size')).toHaveCount(0)
    await l.app.close()
  })
})

test.describe('export', () => {
  async function exportRange(gpu: boolean, start: number, end: number, out: string) {
    const { app, page, userData } = await launch({ file: SAMPLE })
    await waitForVideo(page)
    await app.evaluate(() => undefined)
    await page.evaluate((gpu) => window.clipedit.setSettings({ gpu }), gpu)
    // Settings are read by the renderer at startup; relaunch so the UI reflects them.
    await app.close()
    const l = await launch({ file: SAMPLE, userData })
    await waitForVideo(l.page)
    await stubDialogs(l.app, { save: out })
    await seekTo(l.page, start)
    await l.page.keyboard.press('i')
    await seekTo(l.page, end)
    await l.page.keyboard.press('o')
    await l.page.keyboard.press('Control+e')
    const confirm = l.page.getByTestId('export-confirm')
    await expect(confirm).toBeVisible()
    await expect(l.page.getByTestId('confirm-length')).toContainText(`0:${String(end - start).padStart(2, '0')}.00`)
    await expect(l.page.getByTestId('confirm-encoder')).toHaveText(gpu ? 'GPU · NVIDIA NVENC' : 'CPU · x264')
    const estText = await l.page.getByTestId('confirm-size').innerText()
    await l.page.getByTestId('confirm-export').click()
    await expect(l.page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 })
    return { ...l, estText }
  }

  test('CPU export: exact length, x264, estimate close to real size', async () => {
    const out = join(tempDir(), 'cpu_clip.mp4')
    const { app, page, estText } = await exportRange(false, 5, 15, out)
    expect(existsSync(out)).toBe(true)
    const p = ffprobe(out)
    expect(p.duration).toBeGreaterThan(9.9)
    expect(p.duration).toBeLessThan(10.1)
    expect(p.vcodec).toBe('h264')
    expect(p.acodec).toBe('aac')
    expect(p.encoder).toContain('libx264')
    const estMB = parseFloat(estText.replace(/[^0-9.]/g, ''))
    const realMB = statSync(out).size / 1048576
    expect(Math.abs(estMB - realMB) / realMB).toBeLessThan(0.15)
    await expect(page.getByTestId('done-size')).toBeVisible()
    await page.getByTestId('export-done-ok').click()
    await expect(page.getByTestId('export-done')).toHaveCount(0)
    await app.close()
  })

  test('GPU export uses NVENC', async () => {
    test.skip(process.env.CLIPEDIT_NO_GPU === '1', 'no GPU on this runner')
    const out = join(tempDir(), 'gpu_clip.mkv')
    const { app } = await exportRange(true, 2, 8, out)
    const p = ffprobe(out)
    expect(p.duration).toBeGreaterThan(5.9)
    expect(p.duration).toBeLessThan(6.1)
    expect(p.encoder).toContain('h264_nvenc')
    await app.close()
  })

  test('cancel mid-export deletes the partial file', async () => {
    const out = join(tempDir(), 'canceled.mp4')
    const { app, page, userData } = await launch({ file: fixture('long_1080p.mp4') })
    await waitForVideo(page)
    await page.evaluate(() => window.clipedit.setSettings({ gpu: false }))
    await app.close()
    const l = await launch({ file: fixture('long_1080p.mp4'), userData })
    await waitForVideo(l.page)
    await stubDialogs(l.app, { save: out })
    await l.page.getByTestId('ed-export').click()
    await l.page.getByTestId('confirm-export').click()
    await expect(l.page.getByTestId('export-progress')).toBeVisible()
    await expect.poll(async () => parseInt(await l.page.getByTestId('export-pct').innerText()), { timeout: 30_000 }).toBeGreaterThan(2)
    await l.page.getByTestId('cancel-export').click()
    await expect(l.page.getByTestId('toast')).toContainText('Export canceled')
    await expect(l.page.getByTestId('export-progress')).toHaveCount(0)
    expect(existsSync(out)).toBe(false)
    await l.app.close()
  })

  test('quitting mid-export stops ffmpeg and removes the partial file', async () => {
    const out = join(tempDir(), 'quit.mp4')
    const { app, page, userData } = await launch({ file: fixture('long_1080p.mp4') })
    await waitForVideo(page)
    await page.evaluate(() => window.clipedit.setSettings({ gpu: false }))
    await app.close()
    const l = await launch({ file: fixture('long_1080p.mp4'), userData })
    await waitForVideo(l.page)
    await stubDialogs(l.app, { save: out })
    await l.page.getByTestId('ed-export').click()
    await l.page.getByTestId('confirm-export').click()
    await expect.poll(async () => parseInt(await l.page.getByTestId('export-pct').innerText()), { timeout: 30_000 }).toBeGreaterThan(2)
    expect(existsSync(out)).toBe(true)
    const closed = new Promise<void>((r) => l.app.process().on('exit', () => r()))
    await l.app.evaluate(({ app }) => app.quit())
    await closed
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
    const ours = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      "@(Get-Process ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Quick Editor*' }).Count"
    ]).toString().trim()
    expect(ours).toBe('0')
  })

  test('refuses to overwrite the source file', async () => {
    const dir = tempDir()
    const src = join(dir, 'src.mp4')
    copyFileSync(SAMPLE, src)
    const { app, page } = await launch({ file: src })
    await waitForVideo(page)
    await stubDialogs(app, { save: src })
    await page.getByTestId('ed-export').click()
    await page.getByTestId('confirm-export').click()
    await expect(page.getByTestId('export-error')).toContainText('never overwrites the original')
    expect(statSync(src).size).toBe(statSync(SAMPLE).size)
    await app.close()
  })
})

test.describe('formats needing a preview proxy', () => {
  for (const name of ['sample.avi', 'sample_ac3.mkv', 'sample_hevc.mp4', 'sample.webm']) {
    test(`${name} plays in the editor`, async () => {
      const { app, page } = await launch({ file: fixture(name) })
      await waitForVideo(page)
      const dur = parseTimecode((await page.locator('.transport-time .total').innerText()).replace('/', ''))
      expect(dur).toBeGreaterThan(9)
      await page.getByTestId('play-toggle').click()
      await page.waitForTimeout(600)
      expect(await videoTime(page)).toBeGreaterThan(0.2)
      await app.close()
    })
  }
})

test.describe('settings', () => {
  test('GPU checkbox shows the detected encoder and persists', async () => {
    const { app, page, userData } = await launch()
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('gpu-status')).toContainText('NVENC')
    const box = page.getByTestId('opt-gpu')
    await expect(box).toBeChecked()
    await box.click()
    await expect(box).not.toBeChecked()
    await app.close()
    const again = await launch({ userData })
    await again.page.getByTestId('nav-settings').click()
    await expect(again.page.getByTestId('opt-gpu')).not.toBeChecked()
    await expect(again.page.getByTestId('ctx-status')).toBeVisible()
    await again.app.close()
  })
})

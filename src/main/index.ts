import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, nativeTheme, screen } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, renameSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { VIDEO_EXTENSIONS, isVideoPath, dirOf, stemOf, decidePlayback, type ProbeInfo } from '@shared/formats'
import { buildExportArgs, buildProxyArgs, containerFromPath, targetVideoBitrate, type EncoderId } from '@shared/ffargs'
import { progressFraction, etaSeconds } from '@shared/progress'
import { evenCrop, isFullCrop } from '@shared/crop'
import type { ExportRequest, ExportResult, OpenResult, Settings } from '@shared/api'
import {
  probe, filmstrip, frameDataUrl, runWithProgress, safeUnlink, proxyPathFor, pruneProxies, ffmpegVersion, type RunHandle
} from './ffmpeg'
import { detectGpuEncoder, encoderInfo } from './encoders'
import * as store from './store'
import { registerMediaScheme, handleMediaProtocol, allowMedia } from './media-protocol'
import { contextMenuStatus, installContextMenu, uninstallContextMenu, restartExplorer, refreshExePathIfInstalled } from './context-menu'

// Test hook: isolate profile data.
if (process.env.CLIPEDIT_USER_DATA) app.setPath('userData', process.env.CLIPEDIT_USER_DATA)

app.setAppUserModelId('com.clipedit.app')
nativeTheme.themeSource = 'dark'
registerMediaScheme()

let win: BrowserWindow | null = null
let pendingFile: string | null = fileFromArgv(process.argv)
// Running ffmpeg jobs. On Windows, child processes outlive their parent, so these
// must be stopped (and partial output removed) before the app quits.
let exportRun: RunHandle | null = null
let exportOutput: string | null = null
let proxyRun: RunHandle | null = null
let quitting = false

function fileFromArgv(argv: string[]): string | null {
  // Skip the exe (and the app dir in dev); take the last existing video path.
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i]
    if (!a || a.startsWith('-')) continue
    try {
      const p = resolve(a)
      if (isVideoPath(p) && existsSync(p) && statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (f) win.webContents.send('app:open-file', f)
    }
  })
}

function createWindow(): void {
  const st = store.getWindowState()
  // Ignore saved positions that are now off-screen (monitor unplugged).
  const onScreen =
    st.x !== undefined &&
    st.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return st.x! >= b.x - 50 && st.y! >= b.y - 50 && st.x! < b.x + b.width - 100 && st.y! < b.y + b.height - 100
    })

  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: onScreen ? st.x : undefined,
    y: onScreen ? st.y : undefined,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'ClipEdit',
    icon: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'icon.ico'),
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#d4d4d4', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  if (st.maximized) win.maximize()

  win.once('ready-to-show', () => win?.show())
  const saveState = (): void => {
    if (!win || win.isMinimized()) return
    const b = win.getNormalBounds()
    store.saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
  }
  win.on('close', (e) => {
    if (exportRun && !quitting) {
      const choice = dialog.showMessageBoxSync(win!, {
        type: 'warning',
        title: 'ClipEdit',
        message: 'An export is still running.',
        detail: 'Closing ClipEdit cancels the export and deletes the unfinished file.',
        buttons: ['Keep exporting', 'Cancel export and close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (choice === 0) {
        e.preventDefault()
        return
      }
    }
    saveState()
  })
  win.on('closed', () => {
    win = null
  })

  // Never navigate away from the app; open external links in the browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------------------------------------------------------------- IPC ----

const probeCache = new Map<string, ProbeInfo>()

async function probeCached(path: string): Promise<ProbeInfo> {
  const st = statSync(path)
  const hit = probeCache.get(path)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit
  const info = await probe(path)
  probeCache.set(path, info)
  return info
}

function registerIpc(): void {
  ipcMain.handle('dialog:pick-video', async () => {
    if (process.env.CLIPEDIT_TEST_OPEN) return process.env.CLIPEDIT_TEST_OPEN
    const r = await dialog.showOpenDialog(win!, {
      title: 'Open video',
      properties: ['openFile'],
      filters: [
        { name: 'Video files', extensions: [...VIDEO_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('media:open', async (_e, path: string): Promise<OpenResult> => {
    if (!existsSync(path)) throw new Error('File not found. It may have been moved or deleted.')
    const info = await probeCached(path)
    const play = decidePlayback(info)
    const src = allowMedia(path)
    // A previously generated proxy can be reused immediately.
    const proxy = proxyPathFor(info, !play.copyVideo)
    const haveProxy = !play.direct && existsSync(proxy)
    store.addRecent({ path, name: info.name, size: info.size, duration: info.duration, openedAt: Date.now(), thumb: null })
    // Thumbnail for the recent list, in the background.
    frameDataUrl(path, Math.min(info.duration * 0.1, 30), 120).then((t) => t && store.updateRecentThumb(path, t))
    return {
      info,
      src: haveProxy ? allowMedia(proxy) : src,
      needsProxy: !play.direct && !haveProxy,
      proxyReason: play.reason
    }
  })

  ipcMain.handle('media:proxy', async (e, path: string, transcode: boolean): Promise<string> => {
    const info = await probeCached(path)
    const play = decidePlayback(info)
    const copyVideo = play.copyVideo && !transcode
    const out = proxyPathFor(info, !copyVideo)
    if (existsSync(out)) return allowMedia(out)
    const tmp = out.replace(/\.mp4$/, '.part.mp4')
    const gpu = store.getSettings().gpu ? (await detectGpuEncoder())?.id : undefined
    const attempt = async (encoder: EncoderId): Promise<boolean> => {
      proxyRun?.cancel()
      proxyRun = runWithProgress(
        buildProxyArgs({ input: path, output: tmp, copyVideo, hasAudio: info.hasAudio, encoder }),
        (t) => !e.sender.isDestroyed() && e.sender.send('proxy:progress', progressFraction(t, info.duration))
      )
      const r = await proxyRun.promise
      proxyRun = null
      return r.code === 0
    }
    try {
      let ok = await attempt(gpu ?? 'libx264')
      if (!ok && gpu && !copyVideo) ok = await attempt('libx264')
      if (!ok) {
        safeUnlink(tmp)
        throw new Error('Could not prepare a preview for this file.')
      }
      renameSync(tmp, out)
      pruneProxies()
      return allowMedia(out)
    } finally {
      proxyRun = null
    }
  })

  ipcMain.handle('media:filmstrip', async (_e, path: string, count: number, height: number) => {
    const info = await probeCached(path)
    return filmstrip(path, info.duration, Math.max(1, Math.min(40, count)), Math.max(24, Math.min(160, height)))
  })

  ipcMain.handle('recent:list', () => store.listRecent())
  ipcMain.handle('recent:remove', (_e, path: string) => store.removeRecent(path))
  ipcMain.handle('recent:clear', () => store.clearRecent())

  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => store.setSettings(patch))
  ipcMain.handle('encoders:get', async () => {
    await detectGpuEncoder()
    return encoderInfo()
  })

  ipcMain.handle('export:choose-output', async (_e, input: string) => {
    if (process.env.CLIPEDIT_TEST_SAVE) return process.env.CLIPEDIT_TEST_SAVE
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export clip',
      defaultPath: join(dirOf(input), `${stemOf(input)}_clip.mp4`),
      filters: [
        { name: 'MP4 video', extensions: ['mp4'] },
        { name: 'Matroska video', extensions: ['mkv'] },
        { name: 'QuickTime video', extensions: ['mov'] }
      ],
      properties: ['showOverwriteConfirmation']
    })
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle('export:start', async (e, req: ExportRequest): Promise<ExportResult> => {
    if (resolve(req.output).toLowerCase() === resolve(req.input).toLowerCase()) {
      return { ok: false, canceled: false, error: 'Choose a different file name. ClipEdit never overwrites the original video.', log: '' }
    }
    const info = await probeCached(req.input)
    const len = Math.max(0, req.end - req.start)
    const crop = req.crop && info.width && info.height && !isFullCrop(req.crop, info.width, info.height)
      ? evenCrop(req.crop, info.width, info.height)
      : null
    const areaRatio = crop ? (crop.w * crop.h) / (info.width * info.height) : 1
    const gpuWanted = store.getSettings().gpu
    const gpu = gpuWanted ? (await detectGpuEncoder())?.id : undefined
    const started = Date.now()
    let note: string | undefined

    const attempt = (encoder: EncoderId): Promise<{ code: number; log: string; canceled: boolean }> => {
      const args = buildExportArgs({
        input: req.input,
        output: req.output,
        start: req.start,
        end: req.end,
        encoder,
        videoBitrate: targetVideoBitrate(info, areaRatio),
        hasAudio: info.hasAudio,
        container: containerFromPath(req.output),
        crop
      })
      exportRun = runWithProgress(args, (t, speed) => {
        const fraction = progressFraction(t, len)
        const elapsed = (Date.now() - started) / 1000
        win?.setProgressBar(fraction)
        if (e.sender.isDestroyed()) return
        e.sender.send('export:progress', { fraction, outTime: t, speed, elapsed, eta: etaSeconds(elapsed, fraction), encoder, note })
      })
      return exportRun.promise
    }

    win?.setProgressBar(0.001)
    exportOutput = req.output
    try {
      let encoder: EncoderId = gpu ?? 'libx264'
      let r = await attempt(encoder)
      if (r.code !== 0 && !r.canceled && encoder !== 'libx264') {
        note = 'GPU encoding failed, finished on the CPU instead.'
        encoder = 'libx264'
        r = await attempt(encoder)
      }
      exportRun = null
      if (r.canceled) {
        safeUnlink(req.output)
        return { ok: false, canceled: true, error: 'Export canceled.', log: '' }
      }
      if (r.code !== 0 || !existsSync(req.output)) {
        safeUnlink(req.output)
        const last = r.log.trim().split(/\r?\n/).pop() || 'FFmpeg exited with an error.'
        return { ok: false, canceled: false, error: last, log: r.log }
      }
      if (!e.sender.isDestroyed()) e.sender.send('export:progress', {
        fraction: 1, outTime: len, speed: 0, elapsed: (Date.now() - started) / 1000, eta: 0, encoder, note
      })
      return { ok: true, output: req.output, size: statSync(req.output).size, encoder, elapsed: (Date.now() - started) / 1000, note }
    } finally {
      exportRun = null
      exportOutput = null
      win?.setProgressBar(-1)
    }
  })
  ipcMain.handle('export:cancel', () => exportRun?.cancel())
  ipcMain.handle('shell:show-in-folder', (_e, p: string) => {
    // Missing file: open the folder it lived in, if that still exists.
    if (existsSync(p)) shell.showItemInFolder(p)
    else if (existsSync(dirOf(p))) shell.openPath(dirOf(p))
    else throw new Error('That folder no longer exists.')
  })
  ipcMain.handle('clipboard:text', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('file:copy', async (_e, p: string) => {
    if (!existsSync(p)) throw new Error('File not found. It may have been moved or deleted.')
    // Put the file itself on the clipboard (CF_HDROP) so it pastes into Explorer, Discord, etc.
    const script = `Set-Clipboard -LiteralPath '${p.replace(/'/g, "''")}'`
    await new Promise<void>((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, timeout: 20_000 }, (err) =>
        err ? reject(new Error('Could not copy the file to the clipboard.')) : resolve()
      )
    )
  })
  ipcMain.handle('file:trash', async (_e, p: string) => {
    if (existsSync(p)) await shell.trashItem(p)
    return store.removeRecent(p)
  })

  ipcMain.handle('ctxmenu:status', () => contextMenuStatus())
  ipcMain.handle('ctxmenu:set', async (_e, enabled: boolean) => {
    const s = enabled ? await installContextMenu() : await uninstallContextMenu()
    store.setSettings({ contextMenu: s.state === 'installed' })
    return s
  })
  ipcMain.handle('ctxmenu:restart-explorer', () => restartExplorer())

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    ffmpeg: await ffmpegVersion(),
    electron: process.versions.electron
  }))
  ipcMain.handle('app:take-pending-file', () => {
    const f = pendingFile
    pendingFile = null
    return f
  })
}

app.whenReady().then(() => {
  handleMediaProtocol()
  registerIpc()
  createWindow()
  // Warm up GPU detection so Settings / Export show it instantly.
  detectGpuEncoder()
  refreshExePathIfInstalled().catch(() => undefined)
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (e) => {
  const runs = [exportRun, proxyRun].filter((r): r is RunHandle => !!r)
  if (quitting || runs.length === 0) return
  e.preventDefault()
  quitting = true
  const partial = exportOutput
  runs.forEach((r) => r.cancel())
  Promise.all(runs.map((r) => r.promise)).finally(() => {
    if (partial) safeUnlink(partial)
    app.quit()
  })
})


// Types shared by main, preload and renderer for the window.clipedit bridge.
import type { ProbeInfo } from './formats'
import type { EncoderId } from './ffargs'

export interface RecentItem {
  path: string
  name: string
  size: number
  duration: number
  openedAt: number
  thumb: string | null // data URL (small JPEG) or null while unavailable
  exists: boolean // filled in when listing
}

export interface Settings {
  gpu: boolean
  contextMenu: boolean
  volume: number
  muted: boolean
}

export interface EncoderInfo {
  gpu: { id: EncoderId; label: string } | null
  detecting: boolean
}

export interface OpenResult {
  info: ProbeInfo
  src: string // media URL for <video>
  needsProxy: boolean
  proxyReason: string
}

export interface ExportRequest {
  input: string
  output: string
  start: number
  end: number
}

export interface ExportProgress {
  fraction: number
  outTime: number
  speed: number
  elapsed: number
  eta: number | null
  encoder: EncoderId
  note?: string // e.g. GPU failed -> retried on CPU
}

export type ExportResult =
  | { ok: true; output: string; size: number; encoder: EncoderId; elapsed: number; note?: string }
  | { ok: false; canceled: boolean; error: string; log: string }

export type ContextMenuState = 'installed' | 'not-installed' | 'unavailable'

export interface ContextMenuStatus {
  state: ContextMenuState
  detail: string
}

export interface AppInfo {
  version: string
  ffmpeg: string
  electron: string
}

export interface ClipEditApi {
  // files / media
  pickVideo(): Promise<string | null>
  openMedia(path: string): Promise<OpenResult>
  makeProxy(path: string, transcode: boolean): Promise<string>
  filmstrip(path: string, count: number, height: number): Promise<string[]>
  pathForFile(file: File): string
  // recent
  recentList(): Promise<RecentItem[]>
  recentRemove(path: string): Promise<RecentItem[]>
  recentClear(): Promise<RecentItem[]>
  // settings
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getEncoders(): Promise<EncoderInfo>
  // export
  chooseOutput(input: string): Promise<string | null>
  startExport(req: ExportRequest): Promise<ExportResult>
  cancelExport(): Promise<void>
  showInFolder(path: string): Promise<void>
  copyFile(path: string): Promise<void> // file onto the clipboard (paste in Explorer, chat apps…)
  copyText(text: string): Promise<void>
  trashFile(path: string): Promise<RecentItem[]> // Recycle Bin + drop from recent list
  // context menu
  contextMenuStatus(): Promise<ContextMenuStatus>
  setContextMenu(enabled: boolean): Promise<ContextMenuStatus>
  restartExplorer(): Promise<void>
  // app
  appInfo(): Promise<AppInfo>
  takePendingFile(): Promise<string | null>
  // events (return an unsubscribe fn)
  onOpenFile(cb: (path: string) => void): () => void
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onProxyProgress(cb: (fraction: number) => void): () => void
}

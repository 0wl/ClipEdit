import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ClipEditApi, ExportProgress } from '../shared/api'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api: ClipEditApi = {
  pickVideo: () => ipcRenderer.invoke('dialog:pick-video'),
  openMedia: (path) => ipcRenderer.invoke('media:open', path),
  makeProxy: (path, transcode) => ipcRenderer.invoke('media:proxy', path, transcode),
  filmstrip: (path, count, height) => ipcRenderer.invoke('media:filmstrip', path, count, height),
  pathForFile: (file) => webUtils.getPathForFile(file),

  recentList: () => ipcRenderer.invoke('recent:list'),
  recentRemove: (path) => ipcRenderer.invoke('recent:remove', path),
  recentClear: () => ipcRenderer.invoke('recent:clear'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getEncoders: () => ipcRenderer.invoke('encoders:get'),

  chooseOutput: (input) => ipcRenderer.invoke('export:choose-output', input),
  startExport: (req) => ipcRenderer.invoke('export:start', req),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  showInFolder: (path) => ipcRenderer.invoke('shell:show-in-folder', path),
  copyFile: (path) => ipcRenderer.invoke('file:copy', path),
  copyText: (text) => ipcRenderer.invoke('clipboard:text', text),
  trashFile: (path) => ipcRenderer.invoke('file:trash', path),

  contextMenuStatus: () => ipcRenderer.invoke('ctxmenu:status'),
  setContextMenu: (enabled) => ipcRenderer.invoke('ctxmenu:set', enabled),
  restartExplorer: () => ipcRenderer.invoke('ctxmenu:restart-explorer'),

  appInfo: () => ipcRenderer.invoke('app:info'),
  takePendingFile: () => ipcRenderer.invoke('app:take-pending-file'),

  onOpenFile: (cb) => on<string>('app:open-file', cb),
  onExportProgress: (cb) => on<ExportProgress>('export:progress', cb),
  onProxyProgress: (cb) => on<number>('proxy:progress', cb)
}

contextBridge.exposeInMainWorld('clipedit', api)

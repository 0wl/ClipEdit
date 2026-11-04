import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RecentItem, Settings } from '@shared/api'

const MAX_RECENT = 20

const DEFAULT_SETTINGS: Settings = { gpu: true, contextMenu: false, volume: 1, muted: false }

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function file(name: string): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const p = file(name)
    if (!existsSync(p)) return fallback
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(name: string, data: unknown): void {
  const p = file(name)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, p) // atomic replace so a crash never leaves half-written JSON
}

let settings: Settings | null = null

export function getSettings(): Settings {
  if (!settings) settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>('settings.json', {}) }
  return settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  settings = { ...getSettings(), ...patch }
  writeJson('settings.json', settings)
  return settings
}

export function getWindowState(): WindowState {
  return readJson<WindowState>('window.json', { width: 1280, height: 820, maximized: false })
}

export function saveWindowState(s: WindowState): void {
  writeJson('window.json', s)
}

type StoredRecent = Omit<RecentItem, 'exists'>

export function listRecent(): RecentItem[] {
  return readJson<StoredRecent[]>('recent.json', []).map((r) => ({ ...r, exists: existsSync(r.path) }))
}

function saveRecent(items: StoredRecent[]): RecentItem[] {
  const trimmed = items.slice(0, MAX_RECENT)
  writeJson('recent.json', trimmed)
  return trimmed.map((r) => ({ ...r, exists: existsSync(r.path) }))
}

const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function addRecent(item: StoredRecent): RecentItem[] {
  const prev = readJson<StoredRecent[]>('recent.json', [])
  const old = prev.find((r) => samePath(r.path, item.path))
  const merged = { ...item, thumb: item.thumb ?? old?.thumb ?? null }
  return saveRecent([merged, ...prev.filter((r) => !samePath(r.path, item.path))])
}

export function updateRecentThumb(path: string, thumb: string): void {
  const prev = readJson<StoredRecent[]>('recent.json', [])
  const it = prev.find((r) => samePath(r.path, path))
  if (!it) return
  it.thumb = thumb
  saveRecent(prev)
}

export function removeRecent(path: string): RecentItem[] {
  return saveRecent(readJson<StoredRecent[]>('recent.json', []).filter((r) => !samePath(r.path, path)))
}

export function clearRecent(): RecentItem[] {
  return saveRecent([])
}

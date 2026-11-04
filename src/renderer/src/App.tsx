import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Clock3, FolderOpen, Info, Settings as Gear, FileVideo } from 'lucide-react'
import type { EncoderInfo, OpenResult, RecentItem, Settings } from '@shared/api'
import { isVideoPath } from '@shared/formats'
import { Brand, NavItem } from './components/ui'
import Home from './views/Home'
import SettingsView from './views/Settings'
import Editor from './views/Editor'
import { cleanIpcError, type ToastMsg } from './util'

type View = 'home' | 'settings' | 'editor'

const api = window.clipedit

export default function App(): ReactNode {
  const [view, setView] = useState<View>('home')
  const [clip, setClip] = useState<OpenResult | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [encoders, setEncoders] = useState<EncoderInfo>({ gpu: null, detecting: true })
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const [opening, setOpening] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const exportingRef = useRef(false)
  const toastTimer = useRef<number>(0)

  const showToast = useCallback((t: ToastMsg) => {
    setToast(t)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshRecent = useCallback(() => api.recentList().then(setRecent), [])

  const openPath = useCallback(
    async (path: string) => {
      if (exportingRef.current) {
        showToast({ text: 'Finish or cancel the current export before opening another video.' })
        return
      }
      if (!isVideoPath(path)) {
        showToast({ text: 'That file type isn’t supported.', kind: 'err' })
        return
      }
      setOpening(true)
      try {
        const r = await api.openMedia(path)
        setClip(r)
        setView('editor')
      } catch (e) {
        showToast({ text: cleanIpcError(e), kind: 'err' })
        refreshRecent()
      } finally {
        setOpening(false)
      }
    },
    [showToast, refreshRecent]
  )

  const pickAndOpen = useCallback(async () => {
    if (exportingRef.current) return
    const p = await api.pickVideo()
    if (p) openPath(p)
  }, [openPath])

  // Initial data + file passed on the command line / from Explorer.
  useEffect(() => {
    api.getSettings().then(setSettings)
    api.getEncoders().then(setEncoders)
    refreshRecent()
    api.takePendingFile().then((f) => {
      if (f) openPath(f)
    })
    return api.onOpenFile((f) => openPath(f))
  }, [openPath, refreshRecent])

  useEffect(() => {
    if (view !== 'editor') refreshRecent()
  }, [view, refreshRecent])

  // Drag & drop a video anywhere on the window.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragOver(true)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragOver(false)
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) openPath(api.pathForFile(f))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [openPath])

  // Ctrl+O everywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        pickAndOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickAndOpen])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    setSettings(await api.setSettings(patch))
  }, [])

  const homeSidebar = (
    <aside className="sidebar">
      <Brand />
      <div className="nav-section">General</div>
      <NavItem icon={Clock3} label="Recent" active={view === 'home'} onClick={() => setView('home')} badge={recent.length} testId="nav-recent" />
      <NavItem icon={FolderOpen} label="Open" hint="Ctrl+O" onClick={pickAndOpen} disabled={opening} testId="nav-open" />
      <NavItem icon={Gear} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} testId="nav-settings" />
    </aside>
  )

  return (
    <>
      <div className="drag-strip" />
      {view === 'editor' && clip && settings ? (
        <Editor
          key={clip.info.path + clip.info.mtimeMs}
          clip={clip}
          settings={settings}
          encoders={encoders}
          onOpen={pickAndOpen}
          onClose={() => {
            setClip(null)
            setView('home')
          }}
          onSettings={updateSettings}
          onExportingChange={(b) => (exportingRef.current = b)}
          toast={showToast}
        />
      ) : (
        <div className="app">
          {homeSidebar}
          <main className="main">
            {view === 'settings' && settings ? (
              <SettingsView
                settings={settings}
                encoders={encoders}
                recentCount={recent.length}
                onSettings={updateSettings}
                onClearRecent={async () => setRecent(await api.recentClear())}
                onHome={() => setView('home')}
                toast={showToast}
              />
            ) : (
              <Home
                items={recent}
                opening={opening}
                onOpen={openPath}
                onPick={pickAndOpen}
                onRemove={async (p) => setRecent(await api.recentRemove(p))}
                onListChange={setRecent}
                toast={showToast}
              />
            )}
          </main>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div>
            <FileVideo size={36} strokeWidth={1.5} />
            Drop to open in ClipEdit
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast${toast.kind === 'err' ? ' err' : ''}`} role="status" data-testid="toast">
          {toast.kind === 'err' ? <AlertCircle size={18} /> : <Info size={18} />}
          {toast.text}
        </div>
      )}
    </>
  )
}

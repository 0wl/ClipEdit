import { useCallback, useState, type ReactNode, type MouseEvent as RMouseEvent } from 'react'
import { Copy, Film, FolderOpen, Link2, ListX, Play, Trash2, UploadCloud } from 'lucide-react'
import type { RecentItem } from '@shared/api'
import { dirOf } from '@shared/formats'
import { formatBytes, formatRelative, formatTime, middleTruncatePath } from '@shared/time'
import { Crumbs, Modal, Tip } from '../components/ui'
import ContextMenu, { type MenuEntry } from '../components/ContextMenu'
import { cleanIpcError, type ToastMsg } from '../util'

const api = window.clipedit

export default function Home(props: {
  items: RecentItem[]
  opening: boolean
  onOpen: (path: string) => void
  onPick: () => void
  onRemove: (path: string) => void
  onListChange: (items: RecentItem[]) => void
  toast: (t: ToastMsg) => void
}): ReactNode {
  const { items, opening, onOpen, onPick, onRemove, onListChange, toast } = props
  const [menu, setMenu] = useState<{ x: number; y: number; item: RecentItem } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<RecentItem | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn()
      if (ok) toast({ text: ok })
    } catch (e) {
      toast({ text: cleanIpcError(e), kind: 'err' })
    }
  }

  const copyFile = (it: RecentItem): Promise<void> => run(() => api.copyFile(it.path), `Copied ${it.name}. Paste it anywhere.`)
  const copyPath = (it: RecentItem): Promise<void> => run(() => api.copyText(it.path), 'File path copied.')
  const showFolder = (it: RecentItem): Promise<void> => run(() => api.showInFolder(it.path))
  const doDelete = async (it: RecentItem): Promise<void> => {
    setConfirmDelete(null)
    try {
      onListChange(await api.trashFile(it.path))
      toast({ text: `${it.name} moved to the Recycle Bin.` })
    } catch (e) {
      toast({ text: cleanIpcError(e), kind: 'err' })
    }
  }

  const openMenu = (e: RMouseEvent, item: RecentItem): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  const menuEntries = (it: RecentItem): MenuEntry[] => [
    { label: 'Open in editor', icon: Play, onSelect: () => onOpen(it.path), disabled: !it.exists || opening, testId: 'ctx-open' },
    { kind: 'separator' },
    { label: 'Copy', icon: Copy, onSelect: () => copyFile(it), disabled: !it.exists, testId: 'ctx-copy' },
    { label: 'Copy path', icon: Link2, onSelect: () => copyPath(it), testId: 'ctx-copy-path' },
    { label: 'Open folder', icon: FolderOpen, onSelect: () => showFolder(it), testId: 'ctx-folder' },
    { kind: 'separator' },
    { label: 'Remove from list', icon: ListX, onSelect: () => onRemove(it.path), testId: 'ctx-remove' },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setConfirmDelete(it), disabled: !it.exists, testId: 'ctx-delete' }
  ]

  return (
    <div className="main-scroll" data-testid="view-home">
      <div className="content">
        <Crumbs items={[{ label: 'ClipEdit' }, { label: 'Recent' }]} />
        <div className="page-head">
          <div>
            <h1 className="page-title">Recently opened</h1>
            <p className="page-sub">Pick up where you left off, or open a new video to trim.</p>
          </div>
          <button className="btn btn-primary" onClick={onPick} disabled={opening} data-testid="home-open">
            <FolderOpen size={18} strokeWidth={2} />
            Open video
          </button>
        </div>

        {items.length === 0 ? (
          <div className="empty" data-testid="home-empty">
            <div className="empty-icon">
              <UploadCloud size={26} strokeWidth={1.6} />
            </div>
            <h3>No recent videos yet</h3>
            <p>Drop a video anywhere in this window, or open one from your PC.</p>
            <button className="btn btn-secondary" onClick={onPick} disabled={opening}>
              <FolderOpen size={17} strokeWidth={1.9} />
              Browse files
            </button>
          </div>
        ) : (
          <div className="card recent-list" data-testid="recent-list">
            {items.map((it) => (
              <div
                key={it.path}
                role="button"
                tabIndex={0}
                className={`recent-row${it.exists ? '' : ' missing'}${menu?.item.path === it.path ? ' menu-open' : ''}`}
                onClick={() => !opening && onOpen(it.path)}
                onContextMenu={(e) => openMenu(e, it)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!opening) onOpen(it.path)
                  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: r.left + 140, y: r.top + r.height / 2, item: it })
                  } else if (e.key === 'Delete' && it.exists) {
                    e.preventDefault()
                    setConfirmDelete(it)
                  } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && it.exists) {
                    e.preventDefault()
                    copyFile(it)
                  }
                }}
                title={it.path}
                data-testid="recent-row"
              >
                <div className="recent-thumb">
                  {it.thumb ? <img src={it.thumb} alt="" draggable={false} /> : <Film size={22} strokeWidth={1.5} />}
                  <span className="dur tnum" data-testid="recent-dur">
                    {formatTime(it.duration, false)}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="recent-name">{it.name}</div>
                  <div className="recent-path">
                    {it.exists ? middleTruncatePath(dirOf(it.path), 64) : <span className="missing-tag">File not found</span>}
                  </div>
                </div>
                <div className="recent-meta">
                  <span className="tnum">{formatBytes(it.size)}</span>
                  <span className="when">{formatRelative(it.openedAt)}</span>
                </div>
                <div className="recent-actions" onClick={(e) => e.stopPropagation()}>
                  <Tip label="Copy file" kbd={['Ctrl', 'C']}>
                    <button className="icon-btn row-btn" aria-label={`Copy ${it.name}`} disabled={!it.exists} onClick={() => copyFile(it)} data-testid="row-copy">
                      <Copy size={16} strokeWidth={1.9} />
                    </button>
                  </Tip>
                  <Tip label="Open folder">
                    <button className="icon-btn row-btn" aria-label={`Open folder of ${it.name}`} onClick={() => showFolder(it)} data-testid="row-folder">
                      <FolderOpen size={16} strokeWidth={1.9} />
                    </button>
                  </Tip>
                  <Tip label="Delete" kbd={['Del']}>
                    <button className="icon-btn row-btn danger" aria-label={`Delete ${it.name}`} disabled={!it.exists} onClick={() => setConfirmDelete(it)} data-testid="row-delete">
                      <Trash2 size={16} strokeWidth={1.9} />
                    </button>
                  </Tip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries(menu.item)} onClose={closeMenu} />}

      {confirmDelete && (
        <Modal key="delete" label="Delete video" onEscape={() => setConfirmDelete(null)} testId="delete-confirm" initialFocus="first">
          <div className="modal-body">
            <div className="modal-icon err">
              <Trash2 size={22} strokeWidth={1.8} />
            </div>
            <h2>Delete this video?</h2>
            <p className="desc">
              <b style={{ color: 'var(--text)' }}>{confirmDelete.name}</b> will be moved to the Recycle Bin and removed from this list. You can restore it from the Recycle Bin.
            </p>
          </div>
          <div className="modal-foot">
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button className="btn btn-danger-solid" onClick={() => doDelete(confirmDelete)} data-testid="confirm-delete">
              <Trash2 size={16} strokeWidth={2} />
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

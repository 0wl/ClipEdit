import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { AppInfo, ContextMenuStatus, EncoderInfo, Settings } from '@shared/api'
import { Checkbox, Crumbs } from '../components/ui'
import { cleanIpcError, type ToastMsg } from '../util'

const api = window.clipedit

export default function SettingsView(props: {
  settings: Settings
  encoders: EncoderInfo
  recentCount: number
  onSettings: (p: Partial<Settings>) => void
  onClearRecent: () => void
  onHome: () => void
  toast: (t: ToastMsg) => void
}): ReactNode {
  const { settings, encoders, recentCount, onSettings, onClearRecent, onHome, toast } = props
  const [ctx, setCtx] = useState<ContextMenuStatus | null>(null)
  const [ctxBusy, setCtxBusy] = useState(false)
  const [ctxJustInstalled, setCtxJustInstalled] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    api.contextMenuStatus().then(setCtx)
    api.appInfo().then(setInfo)
  }, [])

  const toggleCtx = async (on: boolean): Promise<void> => {
    setCtxBusy(true)
    try {
      const s = await api.setContextMenu(on)
      setCtx(s)
      const wanted = on ? 'installed' : 'not-installed'
      if (s.state !== wanted) toast({ text: s.detail || 'Could not change the context menu.', kind: 'err' })
      else setCtxJustInstalled(on)
    } catch (e) {
      toast({ text: cleanIpcError(e), kind: 'err' })
    } finally {
      setCtxBusy(false)
    }
  }

  const ctxOn = ctx?.state === 'installed'
  const gpuAvailable = !!encoders.gpu

  return (
    <div className="main-scroll" data-testid="view-settings">
      <div className="content">
        <Crumbs items={[{ label: 'ClipEdit', onClick: onHome }, { label: 'Settings' }]} />
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Choose how ClipEdit fits into Windows and how clips are exported.</p>

        <h2 className="section-title">Integration</h2>
        <p className="section-sub">Open videos straight from File Explorer.</p>
        <div className="card">
          <label className="setting" htmlFor="opt-ctx">
            <Checkbox
              id="opt-ctx"
              label="Add to context menu"
              checked={ctxOn}
              disabled={ctxBusy || !ctx || ctx.state === 'unavailable'}
              onChange={toggleCtx}
              testId="opt-ctx"
            />
            <div className="setting-text">
              <div className="setting-label">Add to context menu</div>
              <div className="setting-desc">
                Adds <b>Edit with ClipEdit</b> to the right-click menu of video files. The first time, Windows asks for
                administrator approval once to trust ClipEdit’s menu extension.
              </div>
              <div className="setting-meta">
                {!ctx || ctxBusy ? (
                  <span className="pill">
                    <Loader2 size={13} className="spin" />
                    {ctxBusy ? (ctxOn ? 'Removing…' : 'Working…') : 'Checking…'}
                  </span>
                ) : ctx.state === 'installed' ? (
                  <span className="pill ok" data-testid="ctx-status">
                    <span className="dot" />
                    Installed
                  </span>
                ) : ctx.state === 'unavailable' ? (
                  <span className="pill err" data-testid="ctx-status" title={ctx.detail}>
                    <span className="dot" />
                    Unavailable
                  </span>
                ) : (
                  <span className="pill" data-testid="ctx-status">
                    <span className="dot" />
                    Not installed
                  </span>
                )}
                {ctxOn && !ctxBusy && (
                  <span className="setting-desc" style={{ marginTop: 0 }}>
                    {ctxJustInstalled ? 'Not showing yet? ' : 'Menu missing? '}
                    <button
                      className="link-btn"
                      onClick={(e) => {
                        e.preventDefault()
                        api.restartExplorer()
                      }}
                    >
                      Restart File Explorer
                    </button>
                  </span>
                )}
                {ctx?.state === 'unavailable' && <span className="setting-desc" style={{ marginTop: 0 }}>{ctx.detail}</span>}
              </div>
            </div>
          </label>
        </div>

        <h2 className="section-title">Export</h2>
        <p className="section-sub">Clips are re-encoded to H.264 so cuts land exactly where you put them.</p>
        <div className="card">
          <label className="setting" htmlFor="opt-gpu">
            <Checkbox
              id="opt-gpu"
              label="Use GPU acceleration"
              checked={settings.gpu && gpuAvailable}
              disabled={!gpuAvailable}
              onChange={(v) => onSettings({ gpu: v })}
              testId="opt-gpu"
            />
            <div className="setting-text">
              <div className="setting-label">Use GPU acceleration</div>
              <div className="setting-desc">
                Encode on your graphics card instead of the CPU. Usually several times faster and keeps the PC
                responsive. If the GPU encoder fails, ClipEdit falls back to the CPU automatically.
              </div>
              <div className="setting-meta">
                {encoders.detecting ? (
                  <span className="pill">
                    <Loader2 size={13} className="spin" />
                    Detecting GPU…
                  </span>
                ) : encoders.gpu ? (
                  <span className="pill ok" data-testid="gpu-status">
                    <span className="dot" />
                    {encoders.gpu.label} detected
                  </span>
                ) : (
                  <span className="pill" data-testid="gpu-status">
                    <span className="dot" />
                    No supported GPU encoder found, using the CPU
                  </span>
                )}
              </div>
            </div>
          </label>
        </div>

        <h2 className="section-title">Data</h2>
        <p className="section-sub">ClipEdit only remembers the videos you opened. Nothing leaves your PC.</p>
        <div className="card">
          <div className="setting">
            <div className="setting-text">
              <div className="setting-label">Recently opened</div>
              <div className="setting-desc">
                {recentCount === 0 ? 'The list is empty.' : `${recentCount} video${recentCount === 1 ? '' : 's'} in the list.`}
              </div>
            </div>
            <div className="setting-aside">
              <button className="btn btn-secondary btn-sm" disabled={recentCount === 0} onClick={onClearRecent} data-testid="clear-recent">
                Clear list
              </button>
            </div>
          </div>
        </div>

        <h2 className="section-title">About</h2>
        <div className="card about-grid" style={{ marginTop: 14 }}>
          <div>
            <div className="k">ClipEdit</div>
            <div className="v tnum">{info ? `v${info.version}` : '…'}</div>
          </div>
          <div>
            <div className="k">FFmpeg</div>
            <div className="v tnum">{info?.ffmpeg ?? '…'}</div>
          </div>
          <div>
            <div className="k">Electron</div>
            <div className="v tnum">{info?.electron ?? '…'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

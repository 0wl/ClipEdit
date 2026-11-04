import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileVideo, FolderOpen, Pause, Play, Volume1, Volume2, VolumeX, X, AlertTriangle } from 'lucide-react'
import type { EncoderInfo, OpenResult, Settings } from '@shared/api'
import { formatBytes, formatDuration, formatFps, formatTime } from '@shared/time'
import { clampRange, fullRange, moveHandle, snapToFrame, type Range } from '@shared/trim'
import { Brand, Crumbs, NavItem, ProgressBar, SkipIcon, Tip } from '../components/ui'
import Timeline from '../editor/Timeline'
import ExportFlow from '../editor/ExportFlow'
import { useVideoClock } from '../editor/useVideoClock'
import { cleanIpcError, type ToastMsg } from '../util'

const api = window.clipedit

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', wmv3: 'WMV',
  vc1: 'VC-1', prores: 'ProRes', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', ac3: 'AC-3', eac3: 'E-AC-3',
  flac: 'FLAC', dts: 'DTS', wmav2: 'WMA', pcm_s16le: 'PCM'
}
const codecName = (c: string): string => CODEC_NAMES[c] ?? c.toUpperCase()

export default function Editor(props: {
  clip: OpenResult
  settings: Settings
  encoders: EncoderInfo
  onOpen: () => void
  onClose: () => void
  onSettings: (p: Partial<Settings>) => void
  onExportingChange: (b: boolean) => void
  toast: (t: ToastMsg) => void
}): ReactNode {
  const { clip, settings, encoders, onOpen, onClose, onSettings, onExportingChange, toast } = props
  const { info } = clip
  const duration = info.duration

  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [src, setSrc] = useState<string | null>(clip.needsProxy ? null : clip.src)
  const [proxy, setProxy] = useState<{ fraction: number; reason: string } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [range, setRange] = useState<Range>(() => fullRange(duration))
  const [thumbs, setThumbs] = useState<string[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [volume, setVolume] = useState(settings.volume)
  const [muted, setMuted] = useState(settings.muted)
  const triedProxy = useRef(clip.needsProxy)
  const timeRef = useRef<HTMLSpanElement>(null)
  const trackWidth = useRef(0)

  // ---- preview proxy (formats Chromium can't play) ----
  const buildProxy = useCallback(
    async (transcode: boolean, reason: string) => {
      triedProxy.current = true
      setSrc(null)
      setProxy({ fraction: 0, reason })
      const off = api.onProxyProgress((f) => setProxy((p) => (p ? { ...p, fraction: f } : p)))
      try {
        const url = await api.makeProxy(info.path, transcode)
        setSrc(url)
      } catch (e) {
        setFatal(cleanIpcError(e))
      } finally {
        off()
        setProxy(null)
      }
    },
    [info.path]
  )

  useEffect(() => {
    if (clip.needsProxy) buildProxy(false, clip.proxyReason)
  }, [clip, buildProxy])

  // ---- filmstrip ----
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      const aspect = info.width && info.height ? info.width / info.height : 16 / 9
      const w = trackWidth.current || 900
      const count = Math.max(4, Math.min(24, Math.round(w / (64 * aspect))))
      api
        .filmstrip(info.path, count, 72)
        .then((t) => alive && setThumbs(t))
        .catch(() => alive && setThumbs([]))
    }, 50)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [info.path, info.width, info.height])

  // ---- video wiring ----
  useEffect(() => {
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [video, volume, muted])

  useEffect(() => {
    if (!video) return
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onMeta = (): void => {
      // Audio-only playback means the video codec isn't decodable here.
      if (video.videoWidth === 0 && !triedProxy.current) buildProxy(true, 'video codec not supported by the player')
    }
    const onError = (): void => {
      if (!triedProxy.current) buildProxy(true, 'format not supported by the player')
      else setFatal('This video can’t be previewed. You can still trim and export it.')
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('error', onError)
    }
  }, [video, buildProxy])

  useVideoClock(video, (t) => {
    if (timeRef.current) timeRef.current.textContent = formatTime(Math.min(t, duration))
  })

  const seek = useCallback(
    (t: number) => {
      if (!video) return
      const max = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration
      video.currentTime = Math.min(Math.max(0, t), max)
    },
    [video, duration]
  )

  const togglePlay = useCallback(() => {
    if (!video || !src) return
    if (video.paused || video.ended) {
      if (video.ended || video.currentTime >= duration - 0.05) video.currentTime = range.start
      video.play().catch(() => undefined)
    } else video.pause()
  }, [video, src, duration, range.start])

  const skip = useCallback((d: number) => video && seek(video.currentTime + d), [video, seek])

  const persistVolume = useRef<number>(0)
  const changeVolume = (v: number, m: boolean): void => {
    setVolume(v)
    setMuted(m)
    window.clearTimeout(persistVolume.current)
    persistVolume.current = window.setTimeout(() => onSettings({ volume: v, muted: m }), 400)
  }

  const startExport = useCallback(() => {
    if (exporting) return
    if (range.end - range.start <= 0) return
    video?.pause()
    setExporting(true)
  }, [exporting, range, video])

  // Window title shows the open file.
  useEffect(() => {
    document.title = `${info.name} — ClipEdit`
    return () => {
      document.title = 'ClipEdit'
    }
  }, [info.name])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (exporting) return
      const el = e.target as HTMLElement | null
      const k = e.key
      const isArrow = k === 'ArrowLeft' || k === 'ArrowRight'
      // Text inputs keep their keys; the volume slider keeps its arrows.
      if (el?.tagName === 'INPUT' && ((el as HTMLInputElement).type !== 'range' || isArrow)) return
      const fps = info.fps || 30
      if (e.ctrlKey && k.toLowerCase() === 'e') {
        e.preventDefault()
        startExport()
      } else if (e.ctrlKey && k.toLowerCase() === 'w') {
        e.preventDefault()
        onClose()
      } else if (e.ctrlKey || e.altKey || e.metaKey) {
        return
      } else if (k === ' ' || k === 'k' || k === 'K') {
        // Space always means play/pause here, even if a button (e.g. skip) still has focus
        // after a mouse click; Enter still activates focused buttons.
        e.preventDefault()
        if (!e.repeat) togglePlay()
      } else if (isArrow && el?.getAttribute('role') !== 'slider') {
        e.preventDefault()
        const dir = k === 'ArrowLeft' ? -1 : 1
        if (e.shiftKey && video) {
          video.pause()
          seek(snapToFrame(video.currentTime, fps) + dir / fps)
        } else skip(dir * 5)
      } else if (k === 'i' || k === 'I') {
        if (video) setRange((r) => moveHandle(r, 'start', video.currentTime, duration))
      } else if (k === 'o' || k === 'O') {
        if (video) setRange((r) => moveHandle(r, 'end', video.currentTime, duration))
      } else if (k === 'Home') {
        e.preventDefault()
        seek(range.start)
      } else if (k === 'End') {
        e.preventDefault()
        seek(range.end)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exporting, info.fps, startExport, onClose, togglePlay, video, seek, skip, duration, range])

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const resolution = info.width && info.height ? `${info.width}×${info.height}` : ''

  return (
    <div className="app" data-testid="view-editor">
      <aside className="sidebar">
        <Brand />
        <div className="nav-section">Clip</div>
        <NavItem icon={FolderOpen} label="Open" hint="Ctrl+O" onClick={onOpen} disabled={exporting} testId="ed-open" />
        <NavItem icon={X} label="Close" hint="Ctrl+W" onClick={onClose} disabled={exporting} testId="ed-close" />
        <NavItem icon={Download} label="Export" hint="Ctrl+E" primary onClick={startExport} disabled={exporting} testId="ed-export" />
        <div className="sidebar-spacer" />
        <div className="nav-section">Shortcuts</div>
        <div className="shortcut-list">
          <div>
            Play / pause <kbd>Space</kbd>
          </div>
          <div>
            Skip 5 seconds
            <span className="kbd-group">
              <kbd>←</kbd>
              <kbd>→</kbd>
            </span>
          </div>
          <div>
            Step one frame
            <span className="kbd-group">
              <kbd>Shift</kbd>
              <kbd>←</kbd>
              <kbd>→</kbd>
            </span>
          </div>
          <div>
            Set start / end here
            <span className="kbd-group">
              <kbd>I</kbd>
              <kbd>O</kbd>
            </span>
          </div>
          <div>
            Jump to start / end
            <span className="kbd-group">
              <kbd>Home</kbd>
              <kbd>End</kbd>
            </span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="editor">
          <Crumbs items={[{ label: 'Recent', onClick: exporting ? undefined : onClose }, { label: info.name }]} />

          <div className={`stage${playing ? '' : ' paused'}`} onClick={togglePlay} data-testid="stage">
            {src && <video ref={setVideo} src={src} preload="auto" playsInline data-testid="video" />}
            {src && !fatal && (
              <div className="stage-bigplay">
                <Play size={28} fill="currentColor" strokeWidth={0} style={{ marginLeft: 3 }} />
              </div>
            )}
            {proxy && (
              <div className="stage-overlay" data-testid="proxy-overlay">
                <div className="stage-panel">
                  <div className="t">Preparing preview…</div>
                  <div className="s">This format needs a quick conversion to play ({proxy.reason}). Export still uses the original file.</div>
                  <ProgressBar value={proxy.fraction} indeterminate={proxy.fraction <= 0} />
                </div>
              </div>
            )}
            {fatal && (
              <div className="stage-overlay">
                <div className="stage-panel">
                  <AlertTriangle size={26} style={{ justifySelf: 'center', color: 'var(--danger)' }} />
                  <div className="t">Preview unavailable</div>
                  <div className="s">{fatal}</div>
                </div>
              </div>
            )}
          </div>

          <div className="transport">
            <div className="transport-time">
              <span ref={timeRef} data-testid="time-current">
                0:00.00
              </span>
              <span className="total"> / {formatTime(duration)}</span>
            </div>
            <div className="transport-center">
              <Tip label="Back 5 seconds" kbd={['←']}>
                <button className="icon-btn skip-btn" onClick={() => skip(-5)} aria-label="Back 5 seconds" data-testid="skip-back">
                  <SkipIcon dir="back" />
                </button>
              </Tip>
              <Tip label={playing ? 'Pause' : 'Play'} kbd={['Space']}>
                <button className="play-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} disabled={!src} data-testid="play-toggle" data-state={playing ? 'playing' : 'paused'}>
                  {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />}
                </button>
              </Tip>
              <Tip label="Forward 5 seconds" kbd={['→']}>
                <button className="icon-btn skip-btn" onClick={() => skip(5)} aria-label="Forward 5 seconds" data-testid="skip-fwd">
                  <SkipIcon dir="fwd" />
                </button>
              </Tip>
            </div>
            <div className="transport-right">
              <button className="icon-btn" onClick={() => changeVolume(volume === 0 ? 1 : volume, !muted)} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
                <VolIcon size={19} strokeWidth={1.75} />
              </button>
              <input
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value), false)}
                style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="card">
            <Timeline
              duration={duration}
              range={range}
              onRange={(r) => setRange(clampRange(r, duration))}
              video={video}
              seek={seek}
              thumbs={thumbs}
              onWidth={(w) => (trackWidth.current = w)}
            />
          </div>
        </div>

        <footer className="statusbar" data-testid="statusbar">
          <FileVideo size={15} strokeWidth={1.8} />
          <span className="title" title={info.path} data-testid="footer-title">
            {info.name}
          </span>
          <span className="sep" />
          <span data-testid="footer-size">
            <span className="k">Size</span>
            {formatBytes(info.size)}
          </span>
          <span className="sep" />
          <span data-testid="footer-length">
            <span className="k">Length</span>
            {formatDuration(duration)}
          </span>
          {resolution && (
            <>
              <span className="sep" />
              <span>{resolution}</span>
            </>
          )}
          {info.fps > 0 && (
            <>
              <span className="sep" />
              <span>{formatFps(info.fps)}</span>
            </>
          )}
          <span className="sep" />
          <span>
            {codecName(info.videoCodec)}
            {info.hasAudio ? ` / ${codecName(info.audioCodec)}` : ''}
          </span>
        </footer>
      </main>

      {exporting && (
        <ExportFlow
          info={info}
          range={range}
          settings={settings}
          encoders={encoders}
          onExportingChange={onExportingChange}
          onClose={(msg) => {
            setExporting(false)
            if (msg) toast({ text: msg })
          }}
        />
      )}
    </div>
  )
}

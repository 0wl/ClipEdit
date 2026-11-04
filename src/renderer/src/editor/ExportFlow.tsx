import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Loader2 } from 'lucide-react'
import type { EncoderInfo, ExportProgress, ExportResult, Settings } from '@shared/api'
import type { ProbeInfo } from '@shared/formats'
import { ENCODER_LABELS, estimateSize } from '@shared/ffargs'
import { formatBytes, formatTime } from '@shared/time'
import type { Range } from '@shared/trim'
import { Modal, ProgressBar } from '../components/ui'
import { cleanIpcError } from '../util'

const api = window.clipedit

type Phase =
  | { kind: 'confirm' }
  | { kind: 'choosing' }
  | { kind: 'running'; output: string; p: ExportProgress | null; canceling: boolean }
  | { kind: 'done'; res: Extract<ExportResult, { ok: true }> }
  | { kind: 'error'; error: string; log: string }

export default function ExportFlow(props: {
  info: ProbeInfo
  range: Range
  settings: Settings
  encoders: EncoderInfo
  onClose: (message?: string) => void
  onExportingChange: (b: boolean) => void
}): ReactNode {
  const { info, range, settings, encoders, onClose, onExportingChange } = props
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])

  const len = range.end - range.start
  const est = estimateSize(info, len)
  const gpu = settings.gpu && encoders.gpu ? encoders.gpu : null
  const encoderText = gpu ? `GPU · ${gpu.label}` : 'CPU · x264'

  const start = async (): Promise<void> => {
    setPhase({ kind: 'choosing' })
    const output = await api.chooseOutput(info.path)
    if (!mounted.current) return
    if (!output) {
      onClose()
      return
    }
    setPhase({ kind: 'running', output, p: null, canceling: false })
    onExportingChange(true)
    const off = api.onExportProgress((p) => {
      if (mounted.current) setPhase((ph) => (ph.kind === 'running' ? { ...ph, p } : ph))
    })
    let res: ExportResult
    try {
      res = await api.startExport({ input: info.path, output, start: range.start, end: range.end })
    } catch (e) {
      res = { ok: false, canceled: false, error: cleanIpcError(e), log: '' }
    } finally {
      off()
      onExportingChange(false)
    }
    if (!mounted.current) return
    if (res.ok) setPhase({ kind: 'done', res })
    else if (res.canceled) onClose('Export canceled. Nothing was saved.')
    else setPhase({ kind: 'error', error: res.error, log: res.log })
  }

  if (phase.kind === 'choosing') return null

  if (phase.kind === 'confirm') {
    return (
      <Modal key="confirm" label="Export clip" onEscape={() => onClose()} testId="export-confirm">
        <div className="modal-body">
          <div className="modal-icon">
            <Download size={22} strokeWidth={1.8} />
          </div>
          <h2>Export clip?</h2>
          <p className="desc">Your selection is saved as a new video. The original file stays untouched.</p>
          <dl className="kv">
            <dt>New length</dt>
            <dd data-testid="confirm-length">
              {formatTime(len)}
              <span className="was">of {formatTime(info.duration)}</span>
            </dd>
            <dt>Range</dt>
            <dd>
              {formatTime(range.start)} → {formatTime(range.end)}
            </dd>
            <dt>Estimated size</dt>
            <dd data-testid="confirm-size">
              ≈ {formatBytes(est)}
              <span className="was">of {formatBytes(info.size)}</span>
            </dd>
            <dt>Encoder</dt>
            <dd data-testid="confirm-encoder">{encoderText}</dd>
          </dl>
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={() => onClose()}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={start} data-testid="confirm-export">
            Save as…
          </button>
        </div>
      </Modal>
    )
  }

  if (phase.kind === 'running') {
    const p = phase.p
    const frac = p?.fraction ?? 0
    const name = phase.output.split(/[\\/]/).pop()
    return (
      <Modal key="running" label="Exporting" testId="export-progress">
        <div className="modal-body">
          <div className="modal-icon">
            <Loader2 size={22} strokeWidth={1.8} className="spin" />
          </div>
          <h2>{phase.canceling ? 'Canceling…' : 'Exporting clip'}</h2>
          <p className="desc">{name}</p>
          <div className="big-pct">
            <span className="pct" data-testid="export-pct">
              {Math.floor(frac * 100)}%
            </span>
            <span className="enc">{p ? (p.encoder === 'libx264' ? 'CPU · x264' : `GPU · ${ENCODER_LABELS[p.encoder]}`) : encoderText}</span>
          </div>
          <ProgressBar value={frac} indeterminate={!p} testId="export-bar" />
          <div className="progress-stats">
            <span>
              <b>{formatTime(p?.elapsed ?? 0, false)}</b> elapsed
            </span>
            <span>
              <b>{p?.eta != null ? formatTime(p.eta, false) : '–'}</b> left
            </span>
            <span>
              <b>{p?.speed ? `${p.speed.toFixed(1)}×` : '–'}</b> speed
            </span>
          </div>
          {p?.note && <div className="note">{p.note}</div>}
        </div>
        <div className="modal-foot">
          <button
            className="btn btn-secondary"
            disabled={phase.canceling}
            onClick={() => {
              setPhase({ ...phase, canceling: true })
              api.cancelExport()
            }}
            data-testid="cancel-export"
          >
            Cancel export
          </button>
        </div>
      </Modal>
    )
  }

  if (phase.kind === 'done') {
    const r = phase.res
    return (
      <Modal key="done" label="Export complete" onEscape={() => onClose()} testId="export-done">
        <div className="modal-body">
          <div className="modal-icon ok">
            <CheckCircle2 size={22} strokeWidth={1.9} />
          </div>
          <h2>Export complete</h2>
          <p className="desc">{r.output}</p>
          <dl className="kv">
            <dt>Length</dt>
            <dd>{formatTime(len)}</dd>
            <dt>Size</dt>
            <dd data-testid="done-size">{formatBytes(r.size)}</dd>
            <dt>Took</dt>
            <dd>
              {formatTime(r.elapsed, false)} · {r.encoder === 'libx264' ? 'CPU' : ENCODER_LABELS[r.encoder]}
            </dd>
          </dl>
          {r.note && <div className="note">{r.note}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={() => api.showInFolder(r.output)} data-testid="show-in-folder">
            <FolderOpen size={16} strokeWidth={1.9} />
            Show in folder
          </button>
          <button className="btn btn-primary" onClick={() => onClose()} data-testid="export-done-ok">
            Done
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal key="error" label="Export failed" onEscape={() => onClose()} testId="export-error">
      <div className="modal-body">
        <div className="modal-icon err">
          <AlertTriangle size={22} strokeWidth={1.8} />
        </div>
        <h2>Export failed</h2>
        <p className="desc">{phase.error}</p>
        {phase.log && (
          <details className="log">
            <summary>FFmpeg details</summary>
            <pre>{phase.log}</pre>
          </details>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-primary" onClick={() => onClose()}>
          Close
        </button>
      </div>
    </Modal>
  )
}

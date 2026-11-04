// Explorer integration.
//  * Top-level Windows 11 menu: a signed MSIX ("ClipEditMenu") hosting an
//    IExplorerCommand COM DLL (see shell/). The DLL reads the exe to launch from
//    HKCU\Software\ClipEdit (ExePath / ExeArgs), so nothing is hard-coded.
//  * Classic fallback verbs (Win10, Shift+Right-click, "Show more options").
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { VIDEO_EXTENSIONS } from '@shared/formats'
import type { ContextMenuStatus } from '@shared/api'

const PACKAGE_NAME = 'ClipEditMenu'
const REG_APP = 'HKCU:\\Software\\ClipEdit'
const VERB_KEY = 'ClipEdit'
const VERB_TITLE = 'Edit with ClipEdit'

function shellDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'shell') : join(app.getAppPath(), 'resources', 'shell')
}
const msixPath = (): string => join(shellDir(), 'ClipEditMenu.msix')
const cerPath = (): string => join(shellDir(), 'ClipEditMenu.cer')

/** What the shell should launch: the packaged exe, or electron.exe + app dir in dev. */
function launchTarget(): { exe: string; args: string } {
  if (app.isPackaged) return { exe: process.execPath, args: '' }
  return { exe: process.execPath, args: `"${app.getAppPath()}"` }
}

const psq = (s: string): string => `'${s.replace(/'/g, "''")}'`

function powershell(script: string, timeoutMs = 120_000): Promise<{ ok: boolean; out: string; err: string }> {
  const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'\n$ErrorActionPreference='Stop'\n${script}`, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr).trim() || (error ? String(error.message) : '') })
    )
  })
}

/** Compact, user-facing message out of a PowerShell error dump. */
function cleanError(err: string): string {
  const line = err
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('At line') && !l.startsWith('+') && !l.startsWith('#<')) ?? err
  if (/canceled by the user/i.test(err)) return 'Administrator approval was declined.'
  return line.replace(/^.*?:\s*/, '').slice(0, 300) || 'Unknown error'
}

export async function contextMenuStatus(): Promise<ContextMenuStatus> {
  if (process.platform !== 'win32') return { state: 'unavailable', detail: 'Windows only' }
  if (!existsSync(msixPath())) return { state: 'unavailable', detail: 'Shell extension package is missing from this build.' }
  const r = await powershell(`$p = Get-AppxPackage -Name ${psq(PACKAGE_NAME)}; if ($p) { $p.Status.ToString() }`, 30_000)
  if (!r.ok) return { state: 'unavailable', detail: cleanError(r.err) }
  return r.out ? { state: 'installed', detail: 'Shown when you right-click a video file.' } : { state: 'not-installed', detail: '' }
}

function classicVerbScript(exe: string, args: string): string {
  const cmd = `"${exe}" ${args ? args + ' ' : ''}"%1"`
  const lines = VIDEO_EXTENSIONS.map((ext) => {
    const k = `HKCU:\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\${VERB_KEY}`
    return [
      `New-Item -Path ${psq(k + '\\command')} -Force | Out-Null`,
      `Set-ItemProperty -Path ${psq(k)} -Name '(default)' -Value ${psq(VERB_TITLE)}`,
      `Set-ItemProperty -Path ${psq(k)} -Name 'Icon' -Value ${psq(`"${exe}",0`)}`,
      `Set-ItemProperty -Path ${psq(k + '\\command')} -Name '(default)' -Value ${psq(cmd)}`
    ].join('\n')
  })
  return lines.join('\n')
}

function removeClassicScript(): string {
  return VIDEO_EXTENSIONS.map(
    (ext) => `Remove-Item -Path ${psq(`HKCU:\\Software\\Classes\\SystemFileAssociations\\.${ext}\\shell\\${VERB_KEY}`)} -Recurse -Force -ErrorAction SilentlyContinue`
  ).join('\n')
}

function exePathScript(exe: string, args: string): string {
  return [
    `New-Item -Path ${psq(REG_APP)} -Force | Out-Null`,
    `Set-ItemProperty -Path ${psq(REG_APP)} -Name 'ExePath' -Value ${psq(exe)}`,
    `Set-ItemProperty -Path ${psq(REG_APP)} -Name 'ExeArgs' -Value ${psq(args)}`
  ].join('\n')
}

export async function installContextMenu(): Promise<ContextMenuStatus> {
  const { exe, args } = launchTarget()
  const msix = msixPath()
  const cer = cerPath()
  if (!existsSync(msix) || !existsSync(cer)) return { state: 'unavailable', detail: 'Shell extension package is missing from this build.' }

  // 1) Tell the shell extension what to launch.
  const reg = await powershell(exePathScript(exe, args))
  if (!reg.ok) return { state: 'not-installed', detail: cleanError(reg.err) }

  // 2) Trust the self-signed package certificate (one-time, needs admin -> UAC).
  const trustCheck = await powershell(
    `$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ${psq(cer)}\n` +
      `if (Test-Path ('Cert:\\LocalMachine\\TrustedPeople\\' + $c.Thumbprint)) { 'trusted' } else { 'untrusted' }`
  )
  if (trustCheck.out !== 'trusted') {
    const inner = `Import-Certificate -FilePath ${psq(cer)} -CertStoreLocation 'Cert:\\LocalMachine\\TrustedPeople' | Out-Null`
    const innerEncoded = Buffer.from(inner, 'utf16le').toString('base64')
    const elevate = await powershell(
      `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
        `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${innerEncoded}'\n` +
        `if ($p.ExitCode -ne 0) { throw "Certificate import failed (exit $($p.ExitCode))" }`,
      300_000
    )
    if (!elevate.ok) return { state: 'not-installed', detail: cleanError(elevate.err) }
  }

  // 3) Register the package (per-user, no admin).
  const add = await powershell(`Add-AppxPackage -Path ${psq(msix)} -ForceUpdateFromAnyVersion -ForceApplicationShutdown`, 180_000)
  if (!add.ok) return { state: 'not-installed', detail: cleanError(add.err) }

  // 4) Classic verbs as a fallback for the legacy menu.
  await powershell(classicVerbScript(exe, args))
  return contextMenuStatus()
}

export async function uninstallContextMenu(): Promise<ContextMenuStatus> {
  const r = await powershell(
    `Get-AppxPackage -Name ${psq(PACKAGE_NAME)} | Remove-AppxPackage\n` +
      removeClassicScript() +
      `\nRemove-Item -Path ${psq(REG_APP)} -Recurse -Force -ErrorAction SilentlyContinue`,
    180_000
  )
  if (!r.ok) return { state: 'installed', detail: cleanError(r.err) }
  return contextMenuStatus()
}

/** Keep the launch path current (e.g. after an update moved the exe). Packaged builds only. */
export async function refreshExePathIfInstalled(): Promise<void> {
  if (!app.isPackaged) return
  const s = await contextMenuStatus()
  if (s.state !== 'installed') return
  const { exe, args } = launchTarget()
  await powershell(exePathScript(exe, args) + '\n' + classicVerbScript(exe, args))
}

export async function restartExplorer(): Promise<void> {
  await powershell(
    `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue\nStart-Sleep -Milliseconds 1500\n` +
      `if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }`
  )
}

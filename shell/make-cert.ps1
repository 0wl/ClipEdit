# One-time: create the self-signed code-signing certificate for the ClipEdit menu package.
# The private key stays in shell\build\ClipEdit.pfx (git-ignored); only the public .cer ships.
$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $root 'build'
$pfx   = Join-Path $build 'ClipEdit.pfx'
$cer   = Join-Path $build 'ClipEditMenu.cer'
New-Item -ItemType Directory -Force -Path $build | Out-Null

if (Test-Path $pfx) { Write-Host "Certificate already exists: $pfx"; exit 0 }

$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=ClipEdit' -FriendlyName 'ClipEdit menu package' `
  -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(10) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')

$pw = ConvertTo-SecureString -String 'clipedit' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
# The signing key now lives in the pfx; drop it from the personal store.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -DeleteKey
Write-Host "Created $pfx and $cer (thumbprint $($cert.Thumbprint))"

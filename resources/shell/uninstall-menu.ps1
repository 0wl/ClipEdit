# Removes the ClipEdit Explorer integration (run by the uninstaller).
$ErrorActionPreference = 'SilentlyContinue'
Get-AppxPackage -Name 'ClipEditMenu' | Remove-AppxPackage
Remove-Item -Path 'HKCU:\Software\ClipEdit' -Recurse -Force
foreach ($e in 'mp4','m4v','mov','mkv','webm','avi','wmv','flv','mpg','mpeg','ts','m2ts','mts','3gp','ogv') {
  Remove-Item -Path ("HKCU:\Software\Classes\SystemFileAssociations\.$e\shell\ClipEdit") -Recurse -Force
}

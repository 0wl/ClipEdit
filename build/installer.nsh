; Remove the Explorer context-menu integration on a real uninstall (not on updates,
; which also run the old uninstaller).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\shell\uninstall-menu.ps1"'
  ${endIf}
!macroend

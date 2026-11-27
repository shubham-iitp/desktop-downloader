; Extra NSIS steps for the Windows installer (included by electron-builder).

; A visible "Uninstall" entry next to the app in the Start menu. The app is also listed
; in Settings > Apps > Installed apps, where right-click > Uninstall in Start leads.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall ${PRODUCT_NAME}.lnk"

  ; The app registers itself for magnet: links when it starts (app.setAsDefaultProtocolClient).
  ; Remove that registration, but only if it still points at this install, and not when this
  ; uninstall is the first step of installing a newer version (the links would stop working).
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\magnet\shell\open\command" ""
    StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
      DeleteRegKey HKCU "Software\Classes\magnet"
  ${endIf}
!macroend

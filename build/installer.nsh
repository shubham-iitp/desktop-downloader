; Extra NSIS steps for the Windows installer (included by electron-builder).

; Fresh install or update? Decided before anything is installed: an auto-update passes
; --updated, and a manual install over an existing copy finds electron-builder's install key
; (a real uninstall deletes it). Only a fresh install asks about magnet links on first launch.
; Declared only for the installer: the uninstaller is compiled from this file too and
; would warn (an error here) about an unused variable.
!ifndef BUILD_UNINSTALLER
  Var ddFreshInstall
!endif

!macro customInit
  StrCpy $ddFreshInstall "1"
  ${if} ${isUpdated}
    StrCpy $ddFreshInstall "0"
  ${endIf}
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" +2
    StrCpy $ddFreshInstall "0"
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" +2
    StrCpy $ddFreshInstall "0"
!macroend

; A visible "Uninstall" entry next to the app in the Start menu. The app is also listed
; in Settings > Apps > Installed apps, where right-click > Uninstall in Start leads.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  ; Tells the app to ask "Open magnet links with Downloader?" on its first launch.
  ${if} $ddFreshInstall == "1"
    WriteRegStr HKCU "Software\DesktopDownloader" "AskDefaults" "1"
  ${endIf}
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
    ; .torrent files, and the entry that lists Downloader in Settings > Default apps.
    ReadRegStr $0 HKCU "Software\Classes\.torrent" ""
    StrCmp $0 "DesktopDownloader.Torrent" 0 +2
      DeleteRegValue HKCU "Software\Classes\.torrent" ""
    DeleteRegValue HKCU "Software\Classes\.torrent\OpenWithProgids" "DesktopDownloader.Torrent"
    DeleteRegKey HKCU "Software\Classes\DesktopDownloader.Magnet"
    DeleteRegKey HKCU "Software\Classes\DesktopDownloader.Torrent"
    DeleteRegKey HKCU "Software\DesktopDownloader"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Desktop Downloader"
    ; electron-updater's download cache (app data itself goes via deleteAppDataOnUninstall).
    RMDir /r "$LOCALAPPDATA\desktop-downloader-updater"
  ${endIf}
!macroend

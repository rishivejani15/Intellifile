!include "LogicLib.nsh"

!macro customRemoveFiles
  DetailPrint "Cleaning IntelliFile updater cache..."
  RMDir /r "$LOCALAPPDATA\intellifile-updater"
  RMDir /r "$LOCALAPPDATA\IntelliFile-updater"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    DetailPrint "Removing all IntelliFile application data, updater files, and user caches..."
    RMDir /r "$LOCALAPPDATA\intellifile-updater"
    RMDir /r "$LOCALAPPDATA\IntelliFile-updater"
    RMDir /r "$LOCALAPPDATA\Programs\IntelliFile"
    RMDir /r "$LOCALAPPDATA\Programs\intellifile"
    RMDir /r "$LOCALAPPDATA\IntelliFile"
    RMDir /r "$LOCALAPPDATA\intellifile"
    RMDir /r "$APPDATA\IntelliFile"
    RMDir /r "$APPDATA\intellifile"
  ${EndIf}
!macroend

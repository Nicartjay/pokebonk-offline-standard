; Installation-format marker only. No saves or credentials are stored here.
!macro customInstall
  Push $0
  FileOpen $0 "$INSTDIR\.pokebonk-offline-nsis" w
  FileWrite $0 "pokebonk-offline-standard-nsis"
  FileClose $0
  Pop $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\.pokebonk-offline-nsis"
!macroend

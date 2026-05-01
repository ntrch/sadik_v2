!macro customInstall
  DetailPrint "ESP32 USB driver kuruluyor..."
  nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\cp210x\silabser.inf" /install'
  Pop $0
  ${If} $0 != 0
    DetailPrint "CP210x driver kurulumu başarısız (code: $0). Cihazı tanımak için manuel driver kurulumu gerekebilir."
  ${Else}
    DetailPrint "CP210x driver başarıyla kuruldu."
  ${EndIf}
!macroend

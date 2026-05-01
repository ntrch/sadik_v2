!macro customInstall
  ; CP210x driver — pnputil ile elevated install
  DetailPrint "ESP32 USB driver kuruluyor..."
  nsExec::ExecToLog '"$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\drivers\cp210x\silabser.inf" /install'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Driver kurulumu başarısız (code: $0). Cihazı kullanmak için manuel kurulum gerekebilir."
  ${EndIf}
!macroend

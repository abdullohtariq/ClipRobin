!macro NSIS_HOOK_PREINSTALL
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "cliprobin-api.exe"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Force Windows Explorer to immediately refresh the icon cache and desktop shortcuts
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$SYSDIR\taskkill.exe" /F /IM "cliprobin-api.exe"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend


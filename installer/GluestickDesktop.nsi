; Gluestick Desktop installer (NSIS)
;   makensis /DPAYLOAD_VERSION=0.1.4 /DPAYLOAD_ARCH=amd64 GluestickDesktop.nsi
;
; Desktop is a self-contained GUI app: it creates ~/.glue and installs its
; runtime dependencies (7-Zip, Git, ...) on first use. This installer only
; deploys the two shipped binaries and creates shortcuts.

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef PAYLOAD_VERSION
  !define PAYLOAD_VERSION "0.0.0-dev"
!endif
!ifndef PAYLOAD_ARCH
  !define PAYLOAD_ARCH "amd64"
!endif

!define PRODUCT_NAME "Gluestick Desktop"
!define PRODUCT_PUBLISHER "gluestick.sh"
!define PRODUCT_URL "https://gluestick.sh/"
!define APP_EXE "gluestick.exe"
!define PAYLOAD_DIR "payload\${PAYLOAD_ARCH}"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GluestickDesktop-${PAYLOAD_ARCH}"

Name "${PRODUCT_NAME} ${PAYLOAD_VERSION} (${PAYLOAD_ARCH})"
OutFile "output\GluestickDesktopSetup-${PAYLOAD_ARCH}.exe"
InstallDir "$LOCALAPPDATA\Programs\Gluestick Desktop"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}

  StrCmp "${PAYLOAD_ARCH}" "arm64" 0 archOk
    nsExec::ExecToStack 'powershell.exe -NoProfile -Command "if ($$env:PROCESSOR_ARCHITECTURE -match ''ARM64'' -or $$env:PROCESSOR_ARCHITEW6432 -match ''ARM64'') { exit 0 } else { exit 1 }"'
    Pop $0
    Pop $1
    IntCmp $0 0 archOk arm64Bad arm64Bad
arm64Bad:
    MessageBox MB_OK|MB_ICONSTOP "GluestickDesktopSetup-${PAYLOAD_ARCH}.exe requires Windows on ARM64."
    Abort
archOk:
FunctionEnd

Section "Gluestick Desktop" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  File "${PAYLOAD_DIR}\${APP_EXE}"
  File "${PAYLOAD_DIR}\shim.exe"

  ; Clear the mark-of-the-web so SmartScreen does not block the app.
  nsExec::ExecToLog 'powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath \"$INSTDIR\" -Filter *.exe -File | Unblock-File"'
  Pop $0

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME} (${PAYLOAD_ARCH})"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${PAYLOAD_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${PRODUCT_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\shim.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  DeleteRegKey HKCU "${UNINST_KEY}"
  ; User data in %USERPROFILE%\.glue is intentionally left in place.
SectionEnd

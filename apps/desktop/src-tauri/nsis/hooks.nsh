; GitCat NSIS installer additions.
;
; Everything here is written as a macro on purpose. Tauri includes this file
; near the top of `installer.nsi`, before `PRODUCTNAME`, `MAINBINARYNAME` and
; the rest of the bundler's defines exist, so nothing may be evaluated at
; include time. `GITCAT_TASKS_PAGE` is inserted from the vendored template
; right after the directory page; the two `NSIS_HOOK_*` macros are the hook
; points Tauri itself provides, and both run inside a section, long after the
; defines are in place.
;
; `installer.nsi` next to this file is a verbatim copy of the bundler template
; for the pinned `@tauri-apps/cli` version, carrying nothing but the
; `GITCAT_TASKS_PAGE` insertion. Resync it after a CLI upgrade from
; https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v<version>/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
; and reapply that one insertion.
;
; Windows 11 shows classic shell verbs under "Show more options" rather than in
; the short context menu. Putting them in the short menu needs a registered
; IExplorerCommand handler, which is a shipped DLL, not a registry write.

!define GITCAT_DIRECTORY_VERB "Software\Classes\Directory\shell\GitCat"
!define GITCAT_BACKGROUND_VERB "Software\Classes\Directory\Background\shell\GitCat"

; "1" install the verbs, "0" remove them, "" leave whatever is there alone.
; The empty case is a passive or updater run, where the page never ran and the
; user has not been asked anything.
Var GitCatContextMenu
Var GitCatContextMenuCheckbox

!macro GITCAT_TASKS_PAGE
  Page custom GitCatTasksPage GitCatTasksPageLeave

  Function GitCatTasksPage
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
      StrCpy $GitCatContextMenu ""
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Additional tasks" "Choose how ${PRODUCTNAME} integrates with Windows Explorer."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      StrCpy $GitCatContextMenu ""
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 0u 100% 12u 'Add "Open with ${PRODUCTNAME}" to the Windows Explorer context menu'
    Pop $GitCatContextMenuCheckbox

    ${NSD_CreateLabel} 14u 16u -14u 32u "The entry appears when you right-click a folder, and when you right-click the background of an open folder. On Windows 11 it sits under $\"Show more options$\"."
    Pop $0

    ; A previous install's answer wins; a first install starts with the entry on.
    ReadRegStr $1 SHCTX "${MANUPRODUCTKEY}" "ContextMenu"
    ${If} $1 == "0"
      ${NSD_SetState} $GitCatContextMenuCheckbox ${BST_UNCHECKED}
    ${Else}
      ${NSD_SetState} $GitCatContextMenuCheckbox ${BST_CHECKED}
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function GitCatTasksPageLeave
    ${NSD_GetState} $GitCatContextMenuCheckbox $0
    ${If} $0 = ${BST_CHECKED}
      StrCpy $GitCatContextMenu "1"
    ${Else}
      StrCpy $GitCatContextMenu "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro GITCAT_WRITE_CONTEXT_MENU
  WriteRegStr SHCTX "${GITCAT_DIRECTORY_VERB}" "" 'Open with ${PRODUCTNAME}'
  WriteRegStr SHCTX "${GITCAT_DIRECTORY_VERB}" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "${GITCAT_DIRECTORY_VERB}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; %V, not %1: on a folder background %1 is the verb's own target, and only %V
  ; carries the directory the window is showing.
  WriteRegStr SHCTX "${GITCAT_BACKGROUND_VERB}" "" 'Open with ${PRODUCTNAME}'
  WriteRegStr SHCTX "${GITCAT_BACKGROUND_VERB}" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "${GITCAT_BACKGROUND_VERB}\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'
!macroend

!macro GITCAT_DELETE_CONTEXT_MENU
  DeleteRegKey SHCTX "${GITCAT_DIRECTORY_VERB}"
  DeleteRegKey SHCTX "${GITCAT_BACKGROUND_VERB}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $GitCatContextMenu == "1"
    !insertmacro GITCAT_WRITE_CONTEXT_MENU
    WriteRegStr SHCTX "${MANUPRODUCTKEY}" "ContextMenu" "1"
  ${ElseIf} $GitCatContextMenu == "0"
    !insertmacro GITCAT_DELETE_CONTEXT_MENU
    WriteRegStr SHCTX "${MANUPRODUCTKEY}" "ContextMenu" "0"
  ${Else}
    ; Passive or updater run: nobody was asked, so keep the existing answer and
    ; only refresh the command, which points at an install directory that the
    ; update may have moved.
    ReadRegStr $0 SHCTX "${GITCAT_DIRECTORY_VERB}\command" ""
    ${If} $0 != ""
      !insertmacro GITCAT_WRITE_CONTEXT_MENU
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update runs the old uninstaller before installing; dropping the verbs
  ; there would silently turn the feature off on every release.
  ${If} $UpdateMode <> 1
    !insertmacro GITCAT_DELETE_CONTEXT_MENU
  ${EndIf}
!macroend

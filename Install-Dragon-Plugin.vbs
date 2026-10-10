Option Explicit
Dim shell, fso, root, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
code = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\install-dragon-plugin.ps1"" -Interactive", 0, True)
If code <> 0 Then MsgBox "Installation did not finish. See the installer message. No Codex program files were changed.", 48, "Rosmontis Pet"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
result = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\Autostart-Dragon.ps1"" -Disable", 0, True)
If result <> 0 Then MsgBox "Autostart removal failed. Run Autostart-Dragon.ps1 -Disable for details.", 48, "Rosmontis Pet"

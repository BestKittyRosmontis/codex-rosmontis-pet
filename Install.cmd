@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-dragon-plugin.ps1"
set "PET_EXIT=%ERRORLEVEL%"
pause
exit /b %PET_EXIT%

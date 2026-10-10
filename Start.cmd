@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Dragon.ps1"
set "PET_EXIT=%ERRORLEVEL%"
exit /b %PET_EXIT%

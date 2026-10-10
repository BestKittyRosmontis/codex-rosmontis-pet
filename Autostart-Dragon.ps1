param([switch]$Disable, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
if (!$startup) { throw 'The current-user Startup folder is unavailable.' }
$linkPath = Join-Path $startup 'Codex Rosmontis Pet.lnk'
$marker = 'Codex Rosmontis Pet - current-user autostart v1'
$shell = New-Object -ComObject WScript.Shell
try {
    if (Test-Path -LiteralPath $linkPath) {
        $existing = $shell.CreateShortcut($linkPath)
        if ($existing.Description -ne $marker -or [IO.Path]::GetFileName($existing.TargetPath) -notin @('wscript.exe','powershell.exe')) {
            throw 'A different startup entry already uses this name. It was not changed.'
        }
    }
    if ($Disable) {
        if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath }
        Write-Output 'Dragon pet autostart disabled. No Codex files or pet settings were changed.'
        return
    }
    $launcher = Join-Path $PSScriptRoot 'Start-Dragon.ps1'
    if (!(Test-Path -LiteralPath $launcher)) { throw 'Dragon launcher is missing.' }
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
    $link.WorkingDirectory = $PSScriptRoot
    $link.WindowStyle = 7
    $link.Description = $marker
    $link.IconLocation = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
    $link.Save()
    if (!$NoLaunch) { & (Join-Path $PSScriptRoot 'Start-Dragon.ps1') }
    Write-Output 'Dragon pet autostart enabled for the current user.'
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }

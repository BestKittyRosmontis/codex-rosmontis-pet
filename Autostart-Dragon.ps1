param([switch]$Disable, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime\windows-paths.ps1')
$root = Get-RosmontisPhysicalPath $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
if (!$startup) { throw 'The current-user Startup folder is unavailable.' }
$linkPath = Join-Path $startup 'Codex Rosmontis Pet.lnk'
$marker = 'Codex Rosmontis Pet - current-user autostart v1'
$systemPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcher = Join-Path $root 'Start-Dragon.ps1'
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
$taskName = 'Codex Rosmontis Pet Supervisor'
function Get-OwnedSupervisorTask {
    if (!(Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (!$task) { return $null }
    $actions = @($task.Actions)
    if ($actions.Count -ne 1 -or [IO.Path]::GetFileName($actions[0].Execute) -ine 'powershell.exe' -or
        !$actions[0].Arguments.ToLowerInvariant().Contains('codexrosmontispet\releases\') -or
        $actions[0].Arguments -notmatch '(?:Start-Dragon|supervisor)\.ps1') {
        throw 'The existing supervisor task belongs to a different installation. It was not changed.'
    }
    return $task
}
$shell = New-Object -ComObject WScript.Shell
try {
    if (Test-Path -LiteralPath $linkPath) {
        $existing = $shell.CreateShortcut($linkPath)
        if ($existing.Description -ne $marker -or [IO.Path]::GetFileName($existing.TargetPath) -notin @('wscript.exe','powershell.exe')) {
            throw 'A different startup entry already uses this name. It was not changed.'
        }
    }
    $ownedTask = Get-OwnedSupervisorTask
    if ($Disable) {
        if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath }
        if ($ownedTask) { $null = Disable-ScheduledTask -TaskName $taskName }
        Write-Output 'Rosmontis pet autostart disabled. Pet preferences were preserved.'
        return
    }
    if (!(Test-Path -LiteralPath $launcher)) { throw 'Rosmontis launcher is missing.' }
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $systemPowerShell
    $link.Arguments = $arguments
    $link.WorkingDirectory = $root
    $link.WindowStyle = 7
    $link.Description = $marker
    $link.IconLocation = Join-Path $root 'node_modules\electron\dist\electron.exe'
    $link.Save()
    # Update only an existing task owned by this pet; fresh installs use the
    # Startup shortcut and MCP bootstrap without creating an additional task.
    if ($ownedTask) {
        $action = New-ScheduledTaskAction -Execute $systemPowerShell -Argument $arguments -WorkingDirectory $root
        $null = Set-ScheduledTask -TaskName $taskName -Action $action
        $null = Enable-ScheduledTask -TaskName $taskName
    }
    if (!$NoLaunch) { & $launcher }
    Write-Output 'Rosmontis pet autostart enabled for the current user.'
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }

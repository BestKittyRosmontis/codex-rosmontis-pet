param([switch]$Probe, [string]$ReleaseRoot, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
if ($Probe) {
    $result = @{ launcherExists=(Test-Path -LiteralPath (Join-Path $ReleaseRoot 'Start-Dragon.ps1'));
        electronExists=(Test-Path -LiteralPath (Join-Path $ReleaseRoot 'node_modules\electron\dist\electron.exe'));
        spriteExists=(Test-Path -LiteralPath (Join-Path $ReleaseRoot 'assets\rosmontis.png')) }
    $result.ok = $result.launcherExists -and $result.electronExists -and $result.spriteExists
    [IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    if (!$result.ok) { exit 2 }; return
}
. (Join-Path $PSScriptRoot '..\runtime\windows-paths.ps1')
if (!$ReleaseRoot) {
    $startup = [Environment]::GetFolderPath('Startup')
    $shell = New-Object -ComObject WScript.Shell
    try {
        $link = $shell.CreateShortcut((Join-Path $startup 'Codex Rosmontis Pet.lnk'))
        if ($link.Description -ne 'Codex Rosmontis Pet - current-user autostart v1' -or
            $link.Arguments -notmatch '-File\s+"([^"]+Start-Dragon\.ps1)"') { throw 'Install and enable Rosmontis Pet first.' }
        $ReleaseRoot = Split-Path -Parent $Matches[1]
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
$logicalTemp = Join-Path ([IO.Path]::GetTempPath()) ('rosmontis-startup-check-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $logicalTemp
$temporary = Get-RosmontisPhysicalPath $logicalTemp
$output = Join-Path $temporary 'result.json'
$taskName = 'Codex Rosmontis Verify Startup ' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$marker = 'Rosmontis temporary startup verification ' + $taskName
$scriptPath = Get-RosmontisPhysicalPath $PSCommandPath
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Probe -ReleaseRoot "' + $ReleaseRoot + '" -OutputPath "' + $output + '"'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
try {
    $null = Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description $marker
    Start-ScheduledTask -TaskName $taskName
    for ($attempt=0;$attempt -lt 40;$attempt++) { if (Test-Path -LiteralPath $output) { break }; Start-Sleep -Milliseconds 250 }
    if (!(Test-Path -LiteralPath $output)) { throw 'Ordinary Windows startup probe did not return a result.' }
    $result = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    $result | ConvertTo-Json
    if (!$result.ok) { throw 'Startup paths are inaccessible outside the application context.' }
} finally {
    $owned = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($owned -and $owned.Description -eq $marker) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}

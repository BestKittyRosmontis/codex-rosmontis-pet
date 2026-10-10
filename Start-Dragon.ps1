param([switch]$Stop, [string]$CodexPath)
$ErrorActionPreference = 'Stop'
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$data = Join-Path $env:USERPROFILE '.codex\rosmontis-pet'
$supervisor = Join-Path $PSScriptRoot 'desktop\supervisor.ps1'
if ($Stop) {
    & $supervisor -DataDir $data -Stop
    return
}
$configFile = Join-Path $data 'follow-config.json'
$config = @{}
if (Test-Path -LiteralPath $configFile) {
    $saved = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $saved.PSObject.Properties) { $config[$p.Name] = $p.Value }
}
if (!$CodexPath -and $config.codexPath -and (Test-Path -LiteralPath $config.codexPath)) { $CodexPath = $config.codexPath }
if (!$CodexPath) {
    $localCodex = Join-Path (Split-Path $PSScriptRoot) 'codex-local-26.928.3736.0\app\ChatGPT.exe'
    if (Test-Path -LiteralPath $localCodex) { $CodexPath = $localCodex }
}
if ($CodexPath) {
    $env:DRAGON_CODEX_PATH = (Resolve-Path -LiteralPath $CodexPath).Path
    $config.codexPath = $env:DRAGON_CODEX_PATH
    $hostProcess = Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $env:DRAGON_CODEX_PATH -and $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if ($hostProcess) { $env:DRAGON_CODEX_WINDOW = [string]$hostProcess.MainWindowHandle }
} else {
    $config.Remove('codexPath')
    Remove-Item Env:\DRAGON_CODEX_PATH,Env:\DRAGON_CODEX_WINDOW -ErrorAction SilentlyContinue
}
$electron = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electron)) { throw 'Electron is missing. Run npm ci in this folder first.' }
if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'assets\rosmontis.png'))) { throw 'The generated dragon sprite is not ready yet.' }
[void][IO.Directory]::CreateDirectory($data)
$config.enabled = $true
$config.mode = 'follow-codex'
$config.electronPath = $electron
$config.pluginRoot = $PSScriptRoot
$config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
$pause = Join-Path $data 'pause-until-host-exit.json'
if (Test-Path -LiteralPath $pause) { Remove-Item -LiteralPath $pause }
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $supervisor + '"'), '-DataDir', ('"' + $data + '"')) -WindowStyle Hidden

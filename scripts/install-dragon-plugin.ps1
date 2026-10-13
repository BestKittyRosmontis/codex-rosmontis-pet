param([string]$CodexCli, [switch]$Interactive, [switch]$CheckOnly, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'package-common.ps1')
$source = Get-WhaleFullPath (Join-Path $PSScriptRoot '..')
$base = Get-RosmontisInstallBase
$data = Join-Path $env:USERPROFILE '.codex\rosmontis-pet'
$receiptPath = Join-Path $base 'install-receipt.json'
$marketName = 'rosmontis-pet-local'
$selector = 'rosmontis-pet@' + $marketName
function Notice([string]$Text) {
    if ($Interactive) {
        Add-Type -AssemblyName PresentationFramework
        [void][Windows.MessageBox]::Show($Text, 'Rosmontis Pet')
    } else { Write-Output $Text }
}
function Invoke-Cli([string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $raw = @(& $cli @Arguments 2>&1); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $oldPreference }
    if ($code -ne 0) {
        $diagnostic = $raw -join "`n"
        if ($diagnostic -match 'os error 112|not enough space|disk.*full|No space left') {
            throw 'Not enough disk space to register the plugin. Free space on the installation and Codex data drives, then retry.'
        }
        if ($diagnostic -match 'os error 5|Access is denied|Permission denied') {
            throw 'Codex could not access the plugin files. Check access to the extracted package and Codex data folder, then retry.'
        }
        throw ('Codex plugin command failed (exit ' + $code + '). Check that this Codex supports local plugins, or pass -CodexCli explicitly.')
    }
    $raw = @($raw | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] })
    if ($raw) { return ($raw -join "`n" | ConvertFrom-Json) }
}
function Assert-InstallSpace([string]$Target, [long]$PackageBytes) {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $requirements = @{}
    foreach ($allocation in @(
        @{path=$Target; bytes=$(if (Test-Path -LiteralPath $Target) { 0L } else { $PackageBytes })},
        @{path=$codexHome; bytes=($PackageBytes * 2)}
    )) {
        $drive = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($allocation.path))
        $requirements[$drive] = [long]$requirements[$drive] + [long]$allocation.bytes
    }
    foreach ($drive in $requirements.Keys) {
        $required = $requirements[$drive] + 128MB
        if ([IO.DriveInfo]::new($drive).AvailableFreeSpace -lt $required) {
            throw ('Not enough disk space on ' + $drive + '. Free at least ' + [math]::Ceiling($required/1MB) + ' MiB for installation and the Codex plugin cache, then retry.')
        }
    }
}
try {
    foreach ($location in @($source, $base, $data)) { Assert-WhalePlainPath $location }
    if (!$CodexCli) {
        $hosts = Get-Process -Name Codex,ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path }
        foreach ($hostProcess in $hosts) {
            $candidate = Join-Path (Split-Path -Parent $hostProcess.Path) 'resources\codex.exe'
            if (Test-Path -LiteralPath $candidate) { $CodexCli = $candidate; break }
        }
    }
    $cli = Find-WhaleCodex $CodexCli
    if ($Uninstall) {
        if (!(Test-Path -LiteralPath $receiptPath)) { throw 'No dragon plugin installation receipt exists.' }
        $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $installedRoot = Get-WhaleFullPath $receipt.target
        if (Test-Path -LiteralPath $installedRoot -PathType Container) {
            Assert-WhalePlainPath $installedRoot
            $installedRoot = Get-RosmontisPhysicalPath $installedRoot
        } else {
            $legacyBase = Get-WhaleFullPath (Join-Path $env:LOCALAPPDATA 'CodexRosmontisPet')
            if ($installedRoot.StartsWith($legacyBase + '\releases\', [StringComparison]::OrdinalIgnoreCase)) {
                $installedRoot = Get-WhaleFullPath (Join-Path $base $installedRoot.Substring($legacyBase.Length + 1))
            }
        }
        if ($receipt.plugin -cne $selector -or !$installedRoot.StartsWith($base + '\releases\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation receipt does not belong to this plugin.' }
        Assert-WhalePlainPath $installedRoot
        if ($CheckOnly) { Notice 'Uninstall validation passed.'; return }
        & (Join-Path $installedRoot 'Autostart-Dragon.ps1') -Disable
        & (Join-Path $installedRoot 'Start-Dragon.ps1') -Stop
        $null = Invoke-Cli @('plugin', 'remove', $selector, '--json')
        $null = Invoke-Cli @('plugin', 'marketplace', 'remove', $marketName, '--json')
        Notice 'Plugin removed and startup disabled. Pet preferences, encrypted authorization and history remain in your user profile. Release files remain available for reinstall.'
        return
    }
    $manifest = Get-Content -LiteralPath (Join-Path $source '.codex-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -cne 'rosmontis-pet' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use the dragon plugin release package, not the upstream source installer.' }
    $checks = Get-Content -LiteralPath (Join-Path $source 'package-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $packageBytes = 0L
    foreach ($item in $checks.files) {
        $file = Get-WhaleFullPath (Join-Path $source $item.path)
        if (!$file.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Invalid or missing release file.' }
        Assert-WhalePlainPath $file
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $item.sha256) { throw 'Release checksum mismatch. Extract a fresh copy of the archive.' }
        $packageBytes += (Get-Item -LiteralPath $file).Length
    }
    $fingerprint = (Get-FileHash -LiteralPath (Join-Path $source 'package-files.json') -Algorithm SHA256).Hash.Substring(0,12)
    $target = Get-WhaleFullPath (Join-Path $base ('releases\' + $manifest.version + '-' + $fingerprint))
    if (!$target.StartsWith($base + '\releases\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release destination.' }
    Assert-WhalePlainPath $target
    $marketFile = Join-Path $base '.agents\plugins\marketplace.json'
    $oldMarket = $null
    if (Test-Path -LiteralPath $marketFile) {
        $oldMarket = [IO.File]::ReadAllText($marketFile)
        $existing = $oldMarket | ConvertFrom-Json
        if ($existing.name -cne $marketName -or @($existing.plugins).Count -ne 1 -or $existing.plugins[0].name -cne 'rosmontis-pet') { throw 'Marketplace location belongs to another installation.' }
    }
    Assert-InstallSpace $target $packageBytes
    if ($CheckOnly) { @{ok=$true; plugin=$selector; version=$manifest.version; target=$target; cli=$cli} | ConvertTo-Json; return }
    # A packaged Codex process can redirect AppData writes. Persist the real
    # filesystem path so Explorer, login startup and scheduled tasks can use it.
    if (!(Test-Path -LiteralPath $base -PathType Container)) { [void][IO.Directory]::CreateDirectory($base) }
    Assert-WhalePlainPath $base
    $base = Get-RosmontisPhysicalPath $base
    $receiptPath = Join-Path $base 'install-receipt.json'
    $marketFile = Join-Path $base '.agents\plugins\marketplace.json'
    $target = Get-WhaleFullPath (Join-Path $base ('releases\' + $manifest.version + '-' + $fingerprint))
    if (!$target.StartsWith($base + '\releases\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid physical release destination.' }
    Assert-WhalePlainPath $target
    if (!(Test-Path -LiteralPath $target)) {
        $stage = $target + '.stage-' + [Guid]::NewGuid().ToString('N')
        Copy-WhaleTree $source $stage @('.git','output')
        Assert-WhalePlainPath $stage
        if (!$stage.StartsWith($base + '\releases\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging destination.' }
        Move-Item -LiteralPath $stage -Destination $target
    } else {
        foreach ($item in $checks.files) {
            $file = Get-WhaleFullPath (Join-Path $target $item.path)
            if (!$file.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $item.sha256) { throw 'Installed release differs; no files were overwritten.' }
        }
    }
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $marketFile))
    $entry = @{ name='rosmontis-pet'; source=@{ source='local'; path=('./releases/' + (Split-Path -Leaf $target)) }; policy=@{ installation='AVAILABLE'; authentication='ON_INSTALL' }; category='Productivity' }
    Write-WhaleReceipt $marketFile @{ name=$marketName; interface=@{displayName='Rosmontis Pet (Local)'}; plugins=@($entry) }
    try {
        $null = Invoke-Cli @('plugin', 'marketplace', 'add', $base, '--json')
        $null = Invoke-Cli @('plugin', 'add', $selector, '--json')
        $catalog = Invoke-Cli @('plugin', 'list', '--marketplace', $marketName, '--json')
        $installed = @($catalog.installed | Where-Object { $_.pluginId -ceq $selector -and $_.version -ceq $manifest.version -and $_.enabled -eq $true -and $_.installed -eq $true })
        if ($installed.Count -ne 1) { throw 'Codex did not confirm one enabled dragon plugin.' }
    } catch {
        if ($null -ne $oldMarket) { [IO.File]::WriteAllText($marketFile, $oldMarket, [Text.UTF8Encoding]::new($false)) }
        throw
    }
    # Stop only the pet supervisor; Codex stays open and no program binaries change.
    & (Join-Path $target 'Start-Dragon.ps1') -Stop
    for ($attempt=0; $attempt -lt 100; $attempt++) {
        if (!(Test-Path -LiteralPath (Join-Path $data 'supervisor-state.json'))) { break }
        Start-Sleep -Milliseconds 150
    }
    if (Test-Path -LiteralPath (Join-Path $data 'supervisor-state.json')) { throw 'Old pet is still stopping. Retry installation after it exits.' }
    & (Join-Path $target 'Autostart-Dragon.ps1') -NoLaunch
    & (Join-Path $target 'Start-Dragon.ps1')
    Write-WhaleReceipt $receiptPath @{ plugin=$selector; version=$manifest.version; target=$target; installedAt=[DateTime]::UtcNow.ToString('o') }
    Notice "Installed Rosmontis Pet. It starts with Codex. Open a new chat to load the plugin tools.`nBilling: pet menu > Codex usage > Log in and authorize. Every recipient uses their own account."
} catch {
    Notice ('Installation incomplete: ' + $_.Exception.Message)
    exit 1
}

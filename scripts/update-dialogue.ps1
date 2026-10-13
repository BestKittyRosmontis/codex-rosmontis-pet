param([string]$DataDir, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'package-common.ps1')
if (!$DataDir) { $DataDir = Join-Path $env:USERPROFILE '.codex\rosmontis-pet' }
Assert-WhalePlainPath $DataDir
$file = Join-Path $DataDir '.dshw-bubble.json'
if (!(Test-Path -LiteralPath $file)) { return }
$original = [IO.File]::ReadAllText($file)
$config = $original | ConvertFrom-Json
$dialogue = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\docs\dialogue.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($dialogue.Count -lt 48) { throw 'The original dialogue pool is missing.' }
$known = @($dialogue | Select-Object -First 48)
$script:addedCount = 0
function Update-KnownPool($Value) {
    if ($null -eq $Value -or $Value -is [string]) { return }
    if ($Value -is [System.Array]) { foreach ($child in $Value) { Update-KnownPool $child }; return }
    if ($Value -isnot [PSCustomObject]) { return }
    if ($Value.type -eq 'random' -and $Value.lines) {
        $texts = @($Value.lines | ForEach-Object { $_.t })
        if (@($known | Where-Object { $texts -cnotcontains $_ }).Count -eq 0) {
            foreach ($line in $dialogue) {
                if ($texts -cnotcontains $line) {
                    $Value.lines = @($Value.lines) + @([PSCustomObject]@{t=$line;w=3;bold=$true;size=8})
                    $script:addedCount++
                }
            }
        }
    }
    foreach ($property in $Value.PSObject.Properties) { Update-KnownPool $property.Value }
}
Update-KnownPool $config
if ($CheckOnly -or $script:addedCount -eq 0) {
    @{dialogueAdditions=$script:addedCount;checkOnly=[bool]$CheckOnly} | ConvertTo-Json -Compress
    return
}
$backupDir = Join-Path $DataDir 'backups'
Assert-WhalePlainPath $backupDir
[void][IO.Directory]::CreateDirectory($backupDir)
$suffix = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$backup = Join-Path $backupDir ('bubble-before-dialogue-' + $suffix + '.json')
[IO.File]::WriteAllText($backup, $original, [Text.UTF8Encoding]::new($false))
$temporary = Join-Path $DataDir ('.dialogue-update-' + $suffix + '.tmp')
try {
    [IO.File]::WriteAllText($temporary, ($config | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $file -Force
} finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
@{dialogueAdditions=$script:addedCount;backedUp=$true} | ConvertTo-Json -Compress

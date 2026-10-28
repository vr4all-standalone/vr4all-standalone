param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][int]$AppPid,
    [Parameter(Mandatory = $true)][int]$LauncherPid,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
$targetDirectory = Split-Path -Path $Target -Parent
$backup = "$Target.vr4all-backup-$([guid]::NewGuid().ToString('N'))"
$staged = "$Target.vr4all-next-$([guid]::NewGuid().ToString('N'))"

function Write-UpdateReport([string]$message) {
    $reportDirectory = Split-Path -Path $ReportPath -Parent
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
    Set-Content -LiteralPath $ReportPath -Value "$(Get-Date -Format o) $message" -Encoding UTF8
}

function Get-UpdateSha256([string]$filePath) {
    $stream = [IO.File]::OpenRead($filePath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

try {
    if (-not [IO.Path]::IsPathRooted($Target) -or -not [IO.Path]::IsPathRooted($Candidate)) { throw 'Update paths must be absolute.' }
    if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid expected SHA-256 digest.' }
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw 'The launched VR4ALL executable is missing.' }
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { throw 'The downloaded VR4ALL executable is missing.' }

    $actual = Get-UpdateSha256 $Candidate
    if ($actual -ne $ExpectedSha256) { throw 'Downloaded VR4ALL checksum does not match GitHub.' }

    foreach ($processId in @($AppPid, $LauncherPid) | Select-Object -Unique) {
        if ($processId -le 0 -or $processId -eq $PID) { continue }
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            Wait-Process -Id $processId -Timeout 120 -ErrorAction Stop
        }
    }

    Copy-Item -LiteralPath $Candidate -Destination $staged -ErrorAction Stop
    if ((Get-UpdateSha256 $staged) -ne $ExpectedSha256) { throw 'Staged VR4ALL checksum changed during copying.' }

    $movedOld = $false
    for ($attempt = 0; $attempt -lt 30 -and -not $movedOld; $attempt++) {
        try { Move-Item -LiteralPath $Target -Destination $backup -ErrorAction Stop; $movedOld = $true }
        catch { if ($attempt -eq 29) { throw }; Start-Sleep -Milliseconds 500 }
    }
    Move-Item -LiteralPath $staged -Destination $Target -ErrorAction Stop
    if (-not $SkipLaunch) { Start-Process -FilePath $Target -WorkingDirectory $targetDirectory -ErrorAction Stop | Out-Null }
    Write-UpdateReport "updated: $Target"
    Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Candidate -Force -ErrorAction SilentlyContinue
    exit 0
} catch {
    $message = $_.Exception.Message
    if (Test-Path -LiteralPath $backup -PathType Leaf) {
        if (Test-Path -LiteralPath $Target -PathType Leaf) { Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue }
        Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue
    }
    try { Write-UpdateReport "failed: $message" } catch { }
    if (-not $SkipLaunch -and (Test-Path -LiteralPath $Target -PathType Leaf)) {
        try { Start-Process -FilePath $Target -WorkingDirectory $targetDirectory -ErrorAction Stop | Out-Null } catch { }
    }
    exit 1
} finally {
    if (Test-Path -LiteralPath $staged -PathType Leaf) { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }
}

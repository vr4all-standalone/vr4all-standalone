param(
    [Parameter(Mandatory = $true)][string]$KitScript,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [string]$JavaHome
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

try {
    # Shared by RDR and GTA SA, using each game's own source kit requirements.
    # Load bootstrap declarations only. Never run the author's main installer,
    # confirmation helpers, or automatic license-answering wrapper here.
    $tokens = $null
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($KitScript, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -ne 0) { throw 'The official Android game build script could not be parsed.' }
    $configuration = @('script:PinnedFiles')
    $optionalConfiguration = @('script:ModVersion')
    $helpers = @('Get-FullPath', 'Test-IsUnderPath', 'Move-AsideIfPresent', 'Format-DownloadSize', 'Invoke-DownloadWithProgress', 'Get-VerifiedDownload', 'Expand-ZipToFreshDirectory', 'Invoke-NativeCapture', 'Resolve-JavaHome', 'Install-AndroidCommandLineTools', 'Test-AndroidPackages')
    $loaded = @{}
    foreach ($statement in $ast.EndBlock.Statements) {
        if ($statement -is [Management.Automation.Language.AssignmentStatementAst] -and
            $statement.Left -is [Management.Automation.Language.VariableExpressionAst] -and
            ($configuration + $optionalConfiguration) -contains $statement.Left.VariablePath.UserPath) {
            . ([scriptblock]::Create($statement.Extent.Text))
            $loaded[$statement.Left.VariablePath.UserPath] = $true
        }
        if ($statement -is [Management.Automation.Language.FunctionDefinitionAst] -and $helpers -contains $statement.Name) {
            . ([scriptblock]::Create($statement.Extent.Text))
            $loaded[$statement.Name] = $true
        }
    }
    foreach ($name in ($configuration + $helpers)) {
        if (-not $loaded.ContainsKey($name)) { throw "The official Android game source kit is missing $name." }
    }
    $sdkRoot = Join-Path ([IO.Path]::GetFullPath($WorkDir)) '.android-sdk'
    $downloads = Join-Path $WorkDir '.downloads'
    $tools = Join-Path $WorkDir '.tools'
    New-Item -ItemType Directory -Path $sdkRoot,$downloads,$tools -Force | Out-Null
    $javaOptions = @{ DownloadRoot = $downloads; ToolsRoot = $tools }
    if (-not [string]::IsNullOrWhiteSpace($JavaHome)) { $javaOptions.Requested = $JavaHome }
    $javaHome = Resolve-JavaHome @javaOptions
    $env:JAVA_HOME = $javaHome
    $classpath = Install-AndroidCommandLineTools -SdkRoot $sdkRoot -DownloadRoot $downloads -ToolsRoot $tools
    $javaExe = Join-Path $javaHome 'bin\java.exe'
    if (-not (Test-Path -LiteralPath $classpath -PathType Leaf) -or -not (Test-Path -LiteralPath $javaExe -PathType Leaf)) {
        throw 'The official Java or Android SDK bootstrap is incomplete.'
    }
    # Derive package versions from the author's file requirements on an empty
    # root, then check the actual root (including zero-byte partial downloads).
    $probe = Join-Path $PSScriptRoot 'empty-sdk-probe'
    $requirements = @(Test-AndroidPackages -SdkRoot $probe)
    if ($requirements.Count -eq 0) { throw 'The official source kit returned no SDK requirements.' }
    $packages = @()
    foreach ($requirement in $requirements) {
        if (-not ([string]$requirement).StartsWith($probe + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsupported SDK requirement path.' }
        $relative = ([string]$requirement).Substring($probe.Length + 1)
        $parts = $relative -split '[\\/]'
        if ($parts.Count -lt 3 -or $parts[0] -notin @('platforms', 'build-tools', 'ndk', 'cmake')) { throw 'Unsupported SDK component.' }
        $file = Get-Item -LiteralPath (Join-Path $sdkRoot $relative) -ErrorAction SilentlyContinue
        if ($null -eq $file -or $file.PSIsContainer -or $file.Length -eq 0) { $packages += "$($parts[0]);$($parts[1])" }
    }
    $metadata = @{ javaExe = $javaExe; javaHome = $javaHome; classpath = $classpath; sdkRoot = $sdkRoot; packages = @($packages | Select-Object -Unique) }
    Write-Output ('VR4ALL_SDK_READY:' + ($metadata | ConvertTo-Json -Compress))
    exit 0
} catch {
    Write-Output ('Build tool preparation failed: ' + $_.Exception.Message)
    exit 1
}

param(
    [Parameter(Mandatory = $true)][string]$KitScript,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [string]$JavaHome
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding

try {
    # Import only bootstrap declarations from the commit-verified source kit.
    # Dot-sourcing the whole script would also run its game installer.
    $tokens = $null
    $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($KitScript, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -ne 0) { throw 'The official build script could not be parsed for tool setup.' }
    $configuration = @('androidCommandLineToolsVersion', 'androidCommandLineToolsUrl', 'androidCommandLineToolsSha256', 'jdkVersion', 'jdkUrl', 'jdkSha256', 'ndkVersion', 'cmakeVersion')
    $helpers = @('Find-JavaHome', 'Ensure-AndroidCommandLineTools', 'Get-MissingSdkPackages')
    $loaded = @{}
    foreach ($statement in $ast.EndBlock.Statements) {
        if ($statement -is [Management.Automation.Language.AssignmentStatementAst] -and
            $statement.Left -is [Management.Automation.Language.VariableExpressionAst] -and
            $configuration -contains $statement.Left.VariablePath.UserPath) {
            . ([scriptblock]::Create($statement.Extent.Text))
            $loaded[$statement.Left.VariablePath.UserPath] = $true
        }
        if ($statement -is [Management.Automation.Language.FunctionDefinitionAst] -and $helpers -contains $statement.Name) {
            . ([scriptblock]::Create($statement.Extent.Text))
            $loaded[$statement.Name] = $true
        }
    }
    foreach ($name in ($configuration + $helpers)) {
        if (-not $loaded.ContainsKey($name)) { throw "The official source kit does not support tool setup: missing $name." }
    }
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    $javaHome = Find-JavaHome
    $env:JAVA_HOME = $javaHome
    $sdkRoot = Join-Path ([IO.Path]::GetFullPath($WorkDir)) '.android-sdk'
    $manager = Ensure-AndroidCommandLineTools -SdkRoot $sdkRoot
    $classpath = Join-Path (Split-Path -Parent (Split-Path -Parent $manager)) 'lib\sdkmanager-classpath.jar'
    $javaExe = Join-Path $javaHome 'bin\java.exe'
    if (-not (Test-Path -LiteralPath $classpath -PathType Leaf) -or -not (Test-Path -LiteralPath $javaExe -PathType Leaf)) {
        throw 'The official Java or Android SDK bootstrap is incomplete.'
    }
    # Ask the author helper about an empty root to obtain every requirement.
    # An interrupted download can leave a directory without usable binaries.
    $requirements = @(Get-MissingSdkPackages -SdkRoot (Join-Path $PSScriptRoot 'empty-sdk-probe'))
    if ($requirements.Count -eq 0) { throw 'The official source kit returned no SDK requirements.' }
    $missing = @($requirements | Where-Object {
        if ([string]$_.Package -like 'build-tools;*') {
            $version = ([string]$_.Package).Split(';')[1]
            $toolRoot = Join-Path $sdkRoot "build-tools\$version"
            $absent = @(@('aapt2.exe', 'zipalign.exe', 'lib\apksigner.jar', 'lib\d8.jar', 'source.properties') | Where-Object {
                $file = Get-Item -LiteralPath (Join-Path $toolRoot $_) -ErrorAction SilentlyContinue
                $null -eq $file -or $file.PSIsContainer -or $file.Length -eq 0
            })
            $absent.Count -ne 0
        } else {
            if ([string]::IsNullOrWhiteSpace([string]$_.Path)) { throw 'The official SDK requirement is missing its file marker.' }
            -not (Test-Path -LiteralPath (Join-Path $sdkRoot $_.Path))
        }
    })
    $metadata = @{ javaExe = $javaExe; javaHome = $javaHome; classpath = $classpath; sdkRoot = $sdkRoot; packages = @($missing | ForEach-Object { [string]$_.Package }) }
    Write-Output ('VR4ALL_SDK_READY:' + ($metadata | ConvertTo-Json -Compress))
    exit 0
} catch {
    Write-Output ('Build tool preparation failed: ' + $_.Exception.Message)
    exit 1
}

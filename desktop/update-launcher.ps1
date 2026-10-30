param([Parameter(Mandatory = $true)][string]$CommandLine)

$ErrorActionPreference = 'Stop'
try {
    $result = Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList $CommandLine -ErrorAction Stop
    if ($result.ReturnValue -ne 0 -or $result.ProcessId -le 0) {
        throw "Windows process creation failed ($($result.ReturnValue))."
    }
    Write-Output "started:$($result.ProcessId)"
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

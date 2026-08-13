<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the five-minute dedicated Timestamps sync.

.DESCRIPTION
    The script calls Node directly because scheduled npm/npx invocation is not
    reliable from this project's path, which contains an ampersand. It rebuilds
    only the rolling two-day RepCall window from Pine and uploads it to the
    dashboard; Active Outlets remains in its own hourly scheduled task.
#>

param(
    [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Output $line
}

Set-Location -Path $ProjectPath
$tunnel = $null

try {
    Write-Log "Starting Timestamps sync..."
    . "$PSScriptRoot\production-reference-tunnel.ps1"
    # The five-minute worker must not compete with any longer hourly bridge.
    $tunnel = Open-ProductionReferenceTunnel -LocalPgPort 5437
    $env:DATABASE_URL = $tunnel.DatabaseUrl
    $env:DIRECT_URL = $tunnel.DatabaseUrl
    & node --import tsx "scripts\db-bridge\timestamps\run.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "timestamps/run.ts exited with code $LASTEXITCODE"
    }
    Write-Log "Timestamps sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}
finally {
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\DIRECT_URL -ErrorAction SilentlyContinue
    Close-ProductionReferenceTunnel $tunnel
}

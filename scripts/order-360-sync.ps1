<#
.SYNOPSIS
    Local manual runner for the Order 360 sync.

.DESCRIPTION
    Production runs this daily at 18:30 Africa/Nairobi as the
    order-360-sync-worker Compose service on the VPS (see docker-compose.yml
    and scripts/continuous-sync-worker.ts) - there is no Task Scheduler
    installer for this bridge anymore. This script remains only for a local,
    one-off manual run (e.g. ORDER360_FORCE_FULL=1 after a query.ts fix).

    The script calls Node directly because npm/npx invocation is not
    reliable from this project's path, which contains an ampersand (same
    gotcha as scripts/timestamps-sync.ps1). The very first run backfills the
    trailing 3 months; every run after that only tops up that day's orders -
    scripts/db-bridge/order-360/run.ts decides the mode itself from the saved
    SyncWatermark, nothing to configure here.
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

try {
    Write-Log "Starting Order 360 sync..."
    & node --import tsx "scripts\db-bridge\order-360\run.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "order-360/run.ts exited with code $LASTEXITCODE"
    }
    Write-Log "Order 360 sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the Order 360 sync daily at 18:30.

.DESCRIPTION
    The script calls Node directly because scheduled npm/npx invocation is not
    reliable from this project's path, which contains an ampersand (same
    gotcha as scripts/timestamps-sync.ps1). The very first run backfills the
    trailing 3 months; every run after that only tops up that day's orders -
    scripts/db-bridge/order-360/run.ts decides the mode itself from the saved
    SyncWatermark, nothing to configure here.

    Schedule this in Windows Task Scheduler: Trigger = Daily at 18:30,
    Action = powershell.exe -ExecutionPolicy Bypass -File
    "D:\Reports & Extractions\Sales Dashboard\scripts\order-360-sync.ps1"
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

<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the live Active Outlets + Timestamps sync
    (scripts/db-bridge/active-outlets/run.ts), which pulls purchase/call activity
    straight from the "pine" field-force MySQL DB (159.65.222.131 — a different
    server from PINEFROSTSERVER) and pushes it to the live dashboard's
    ActiveOutlet/ActiveOutletMonthly/RepCall tables via two upload routes.

.DESCRIPTION
    Same pattern as pl-sync.ps1/sales-sync.ps1: runs `node --import tsx` directly
    rather than `npm run active-outlets:sync` - npm/npx fail to resolve the
    project's node_modules when invoked non-interactively from a path containing
    "&" (this project's own folder name), a known quirk on this machine. Every
    non-fatal notice in run.ts uses console.log, not console.warn - stderr output
    from a native command can get misread as a fatal error by this wrapper's
    $ErrorActionPreference = "Stop" in a non-interactive Task Scheduler session
    (the false-failure bug hit and fixed on pl-sync.ps1 this session). Hits a
    different server from the other three scheduled jobs, so there's no real
    collision risk, but still given its own time slot for predictable logs.
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
    Write-Log "Starting Active Outlets + Timestamps sync..."
    & node --import tsx "scripts\db-bridge\active-outlets\run.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "active-outlets/run.ts exited with code $LASTEXITCODE"
    }
    Write-Log "Active Outlets + Timestamps sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

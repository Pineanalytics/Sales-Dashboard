<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the live P&L sync (scripts/pl-bridge/run.ts),
    which pulls journal-entry lines straight from PINEFROSTSERVER (SAP) and pushes
    them to the live dashboard's PLEntry table via /api/pl/upload.

.DESCRIPTION
    Same pattern as sales-sync.ps1: never touches Excel/COM - a plain Node/tsx
    script hitting SQL Server directly. Runs `node --import tsx` directly rather
    than `npm run pl:sync` - npm/npx fail to resolve the project's node_modules
    when invoked non-interactively from a path containing "&" (this project's own
    folder name), a known quirk on this machine. Schedule this offset from both
    the Excel job (06:00/17:00) and sales-sync.ps1's own schedule, so none of the
    three hit PINEFROSTSERVER at the same moment.
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
    Write-Log "Starting P&L sync..."
    & node --import tsx "scripts\pl-bridge\run.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "pl-bridge/run.ts exited with code $LASTEXITCODE"
    }
    Write-Log "P&L sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

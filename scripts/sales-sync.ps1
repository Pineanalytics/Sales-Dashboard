<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the direct-SQL Sales sync
    (scripts/db-bridge/sales-sync.ts), which pulls Revenue/COGS/Gross Profit
    straight from PINEFROSTSERVER (SAP) and pushes it to the live dashboard's
    SalesRecord table via /api/sales/upload.

.DESCRIPTION
    Unlike export-and-upload.ps1, this never touches Excel/COM - it's a plain
    Node/tsx script hitting SQL Server directly. Runs `node --import tsx`
    directly rather than `npm run sales:sync` - npm/npx fail to resolve the
    project's node_modules when invoked non-interactively from a path
    containing "&" (this project's own folder name), a known quirk on this
    machine. Scheduled offset from the Excel job (06:00/17:00) so the two
    don't hit PINEFROSTSERVER at the same moment.
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
    Write-Log "Starting Sales sync..."
    & node --import tsx "scripts\db-bridge\sales-sync.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "sales-sync.ts exited with code $LASTEXITCODE"
    }
    Write-Log "Sales sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

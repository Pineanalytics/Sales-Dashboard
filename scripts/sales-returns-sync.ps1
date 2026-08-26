<#
.SYNOPSIS
  Wrapper for Task Scheduler: runs the Sales & Returns invoice-line bridge
  (scripts/db-bridge/sales-returns/run.ts), which pulls CASHMEMO/DSR/POP/SKU
  detail from the field DMS's SQL Server and pushes it to the live
  dashboard's SalesReturnLine table via /api/sales-returns/upload.

.DESCRIPTION
  Plain Node/tsx script hitting SQL Server directly, same shape as
  sales-sync.ps1/eabl-call-performance-sync.ps1. Runs `node --import tsx`
  directly rather than `npm run sales-returns:sync` — npm/npx fail to resolve
  this project's node_modules when invoked non-interactively from a path
  containing "&" (this project's own folder name), a known quirk on this
  machine.

  Registered as THREE separate Task Scheduler entries (each just this same
  script with a different -Window), not one: the source report is a
  day-grain delivery-date extract, not a live feed, so same-day visibility
  needs same-day partial runs that a later run then corrects —
    -Window Today      20:00 daily — that day's transactions so far.
    -Window Yesterday  07:00 daily — finalizes yesterday once fully closed.
    -Window Catchup    12:00 daily — yesterday+today, catches anything the
                        other two missed.
  Each run only deletes-and-replaces its own delivery-date window
  server-side, so the three overlap safely with no duplication. Offset from
  the other scheduled syncs (SalesDashboard-SalesSync, SalesDashboard-PLSync,
  etc.) so none hit their source servers at the same moment.
#>

param(
  [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard",
  [ValidateSet("Today", "Yesterday", "Catchup")]
  [string]$Window = "Yesterday"
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

Set-Location -Path $ProjectPath
$env:SALES_RETURNS_WINDOW = $Window
try {
  Write-Log "Starting Sales & Returns sync (window: $Window)..."
  & node --import tsx "scripts\db-bridge\sales-returns\run.ts"
  if ($LASTEXITCODE -ne 0) { throw "sales-returns/run.ts exited with code $LASTEXITCODE" }
  Write-Log "Sales & Returns sync finished."
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  throw
}

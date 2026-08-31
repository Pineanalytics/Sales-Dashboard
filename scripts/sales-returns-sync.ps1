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

  Registered as one five-minute Task Scheduler entry with -Window Catchup.
  Catchup fetches yesterday+today on every run: today stays close to live and
  yesterday keeps correcting for late/final transactions. The API's
  distributor-scoped delete-and-replace makes repeated runs idempotent and
  prevents Nairobi/Nyeri from touching each other's rows.
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

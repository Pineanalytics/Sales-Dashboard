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

  Registered as one five-minute Task Scheduler entry with -Window Smart.
  Smart checks SQL's latest real delivery date and exact per-day VPS
  signatures, repairs the oldest mismatch first, and does no extraction when
  nothing changed. The API's distributor-scoped delete-and-replace keeps
  Nairobi and Nyeri isolated.

.PARAMETER BackfillDate
  One exact date (YYYY-MM-DD) to force-repair regardless of Smart's own
  mismatch detection. Add -BackfillTo to widen this into an explicit range
  covering every day from BackfillDate through BackfillTo inclusive, in one
  run — needed to repair PjpDsrDailyActivity/OutletSkuDailySales history for
  a branch whose invoice-line signatures were already stable before those
  companion reports existed (Smart mode alone never revisits such a day).
  Run this manually on each branch's own machine; it never touches the other
  branch. Keep a single request to about a month given a live SQL Server
  query per report across the full range.

.EXAMPLE
  ./sales-returns-sync.ps1 -BackfillDate 2026-03-01 -BackfillTo 2026-03-31
  Repairs every report, including PjpDsrDailyActivity, for March 2026 on
  this machine's own branch in one run.
#>

param(
  [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$Distributor = $env:SALES_RETURNS_DISTRIBUTOR,
  [ValidateSet("Smart", "Today", "Yesterday", "Catchup")]
  [string]$Window = "Smart",
  [string]$BackfillDate,
  [string]$BackfillTo
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

Set-Location -Path $ProjectPath

function Get-DotEnvValue {
  param([string]$Name)
  $line = Get-Content -Path ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$Name\s*=\s*", "") -replace '^"(.*)"$', '$1'
}

$apiKey = Get-DotEnvValue -Name "UPLOAD_API_KEY"
$Distributor = if ($Distributor) { $Distributor } else { Get-DotEnvValue -Name "SALES_RETURNS_DISTRIBUTOR" }
$selectedDate = $null
if ($BackfillDate) {
  if ($BackfillDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or -not [datetime]::TryParseExact($BackfillDate, 'yyyy-MM-dd', $null, [Globalization.DateTimeStyles]::None, [ref]$selectedDate)) {
    throw "BackfillDate must be a real YYYY-MM-DD date."
  }
}
$selectedToDate = $null
if ($BackfillTo) {
  if (-not $BackfillDate) { throw "BackfillTo requires BackfillDate." }
  if ($BackfillTo -notmatch '^\d{4}-\d{2}-\d{2}$' -or -not [datetime]::TryParseExact($BackfillTo, 'yyyy-MM-dd', $null, [Globalization.DateTimeStyles]::None, [ref]$selectedToDate)) {
    throw "BackfillTo must be a real YYYY-MM-DD date."
  }
  if ($selectedToDate -lt $selectedDate) { throw "BackfillTo must not be earlier than BackfillDate." }
}
$lockScript = Join-Path $PSScriptRoot "sales-returns-sync-lock.ps1"
. $lockScript
$syncLock = Enter-SalesReturnsSyncLock -Distributor $Distributor
if (-not $syncLock.Held) {
  Write-Log "Another Sales & Returns sync is already running for distributor $Distributor; skipping this overlapping launch."
  Exit-SalesReturnsSyncLock -Lock $syncLock
  exit 0
}

$effectiveWindow = $Window
$control = $null
try {
  if ($BackfillDate) {
    $env:SALES_RETURNS_BACKFILL_FROM = $BackfillDate
    if ($BackfillTo) {
      $env:SALES_RETURNS_BACKFILL_TO = $BackfillTo
      $effectiveWindow = "Selected range $BackfillDate to $BackfillTo"
    }
    else {
      $effectiveWindow = "Selected date $BackfillDate"
    }
  }
  elseif ($apiKey -and $Distributor) {
    try {
      $control = Invoke-RestMethod -Uri "$AppUrl/api/sales-returns/control?distributor=$Distributor" -Method Get `
        -Headers @{ "x-upload-api-key" = $apiKey }
      # The task's historical -Window Catchup argument is only a safe fallback
      # while a backfill pause is active. Once the VPS control is restored to
      # SMART, it must actively override that legacy task argument; otherwise a
      # healthy machine can acknowledge the control yet remain in Catchup
      # forever and never run its reconciliation/heartbeat path.
      $effectiveWindow = if ($control.desiredMode -eq "CATCHUP") { "Catchup" } else { "Smart" }
    }
    catch {
      Write-Log "Could not read branch control; using configured window $Window`: $($_.Exception.Message)"
    }
  }

  $env:SALES_RETURNS_WINDOW = $effectiveWindow
  $status = "APPLIED"
  $summary = ""
  try {
    Write-Log "Starting Sales & Returns sync (window: $effectiveWindow)..."
    & node --import tsx "scripts\db-bridge\sales-returns\run.ts"
    if ($LASTEXITCODE -ne 0) { throw "sales-returns/run.ts exited with code $LASTEXITCODE" }
    $summary = "Scheduled sync completed with window $effectiveWindow."
    Write-Log "Sales & Returns sync finished."
  }
  catch {
    $status = "FAILED"
    $summary = $_.Exception.Message
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
  }
  finally {
    if ($control -and $control.version -gt 0 -and $apiKey -and $Distributor) {
      try {
        Invoke-RestMethod -Uri "$AppUrl/api/sales-returns/control" -Method Patch -ContentType "application/json" `
          -Headers @{ "x-upload-api-key" = $apiKey } `
          -Body (@{ distributor = $Distributor; version = [int]$control.version; status = $status; resultSummary = $summary } | ConvertTo-Json) | Out-Null
      }
      catch { Write-Log "Could not acknowledge branch control: $($_.Exception.Message)" }
    }
  }
}
finally {
  Remove-Item Env:SALES_RETURNS_BACKFILL_FROM -ErrorAction SilentlyContinue
  Remove-Item Env:SALES_RETURNS_BACKFILL_TO -ErrorAction SilentlyContinue
  Exit-SalesReturnsSyncLock -Lock $syncLock
}

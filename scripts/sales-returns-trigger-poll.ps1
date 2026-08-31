<#
.SYNOPSIS
  Polls for a manually-queued "run the sync now" request and runs it if one
  is waiting for this machine's branch.

.DESCRIPTION
  The Centegy machines (Nairobi, Nyeri) are on isolated networks with no
  inbound access — nothing can reach in and trigger a sync directly. This
  script is the other half of that: run every few minutes via Task
  Scheduler, it checks GET /api/sales-returns/trigger/pending (the same
  outbound HTTPS connection the sync itself already uses) for a request
  queued against this machine's own -Distributor from the /admin/dataset
  Sync Health panel's "Trigger now" button, and if one is claimed, runs
  scripts/db-bridge/sales-returns/run.ts with that request's window (or
  single-day repair date) — same invocation shape as sales-returns-sync.ps1, just
  triggered by the queue instead of the clock. Reports back via
  POST /api/sales-returns/trigger/complete either way.

  Deliberately quiet when there's nothing pending — Task Scheduler history
  and this script's own console output are enough to see routine "nothing
  to do" polls; only an actually-triggered sync run itself sends a pipeline
  alert email (via run.ts's own reportRun(), unchanged by this script).

.PARAMETER Distributor
  This machine's own branch distributor code (e.g. Nairobi's "18048241"),
  matching whatever SalesReturnLine.storageLocation this machine's syncs
  actually write. Defaults to reading it from this machine's own
  SALES_RETURNS_DISTRIBUTOR environment variable — set once per machine,
  same pattern as UPLOAD_API_KEY.

.EXAMPLE
  ./sales-returns-trigger-poll.ps1 -ProjectPath "C:\SalesDashboard"
  Checks once for a pending trigger and runs it if found; scheduled every
  few minutes.
#>

param(
  [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$Distributor = $env:SALES_RETURNS_DISTRIBUTOR
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

Set-Location -Path $ProjectPath

# Reads UPLOAD_API_KEY from .env the same way run.ts does (process.loadEnvFile()) -
# this script needs it too, but PowerShell has no equivalent, so parse it directly.
function Get-DotEnvValue {
  param([string]$Name)
  # Match dotenv's practical override behavior: when a legacy file contains
  # duplicate keys, the later definition wins. Nairobi's .env historically has
  # an old blank UPLOAD_API_KEY before the real one.
  $line = Get-Content -Path ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$Name\s*=\s*", "") -replace '^"(.*)"$', '$1'
}

$apiKey = Get-DotEnvValue -Name "UPLOAD_API_KEY"
$Distributor = if ($Distributor) { $Distributor } else { Get-DotEnvValue -Name "SALES_RETURNS_DISTRIBUTOR" }
if (-not $apiKey) { throw "UPLOAD_API_KEY not found in .env at $ProjectPath." }
if (-not $Distributor) { throw "No distributor provided. Pass -Distributor, or set SALES_RETURNS_DISTRIBUTOR in this machine's environment or .env file." }

try {
  $pending = Invoke-RestMethod -Uri "$AppUrl/api/sales-returns/trigger/pending?distributor=$Distributor" -Method Get `
    -Headers @{ "x-upload-api-key" = $apiKey }
}
catch {
  Write-Log "Could not reach the trigger queue: $($_.Exception.Message)"
  exit 0
}

if (-not $pending.pending) {
  Write-Log "No pending trigger for distributor $Distributor."
  exit 0
}

$windowLabel = if ($pending.window) { "-Window $($pending.window)" } else { "-RepairDate $($pending.backfillFrom)" }
Write-Log "Claimed trigger request $($pending.id) ($windowLabel). Running sync..."

if ($pending.window) {
  $env:SALES_RETURNS_WINDOW = $pending.window
} else {
  $env:SALES_RETURNS_BACKFILL_FROM = $pending.backfillFrom
}

$status = "COMPLETED"
$summary = ""
try {
  $output = & node --import tsx "scripts\db-bridge\sales-returns\run.ts" 2>&1 | Tee-Object -Variable outputLines
  if ($LASTEXITCODE -ne 0) { throw "run.ts exited with code $LASTEXITCODE`n$($outputLines -join "`n")" }
  $summary = ($outputLines | Select-Object -Last 5) -join " | "
  Write-Log "Triggered sync finished: $summary"
}
catch {
  $status = "FAILED"
  $summary = $_.Exception.Message
  Write-Log "Triggered sync FAILED: $summary"
}

try {
  Invoke-RestMethod -Uri "$AppUrl/api/sales-returns/trigger/complete" -Method Post -ContentType "application/json" `
    -Headers @{ "x-upload-api-key" = $apiKey } `
    -Body (@{ id = $pending.id; status = $status; resultSummary = $summary } | ConvertTo-Json) | Out-Null
}
catch {
  Write-Log "Could not report trigger completion: $($_.Exception.Message)"
}

if ($status -eq "FAILED") { exit 1 }

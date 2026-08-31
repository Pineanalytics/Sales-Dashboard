<#
.SYNOPSIS
  Pulls the UKL Sales & Returns CSV export from the live dashboard and saves
  it into the local folder the downstream upload system already watches —
  replacing the manual "run the SQL report, save as CSV, copy it here" step.

.DESCRIPTION
  Standalone — no dependency on the Sales-Dashboard repo, Node.js, or the
  Centegy DMS SQL Server, since this runs on a third machine (the one hosting
  D:\UKL_INTEGRATION\UPLOADS) with no direct path to either. Only needs
  outbound HTTPS to the dashboard. Filename matches the existing convention:
  UKL_<BRANCH>_<DD.MM.YYYY>.csv (e.g. UKL_NAIROBI_10.08.2026.csv).

.PARAMETER Branch
  Differentiates files once multiple branches (Nairobi, later Nyeri) feed the
  same destination folder. Defaults to NAIROBI, the only branch live today.

.PARAMETER Date
  YYYY-MM-DD to export. Defaults to today (Africa/Nairobi, no DST) so the
  five-minute schedule continuously refreshes the current day's watched CSV.

.PARAMETER Distributor
  The SalesReturnLine.storageLocation/DISTRIBUTOR code for this branch. When
  omitted it is derived from Branch for the known Nairobi/Nyeri branches.

.PARAMETER ApiKey
  The shared UKL_SALES_EXPORT_KEY. Defaults to reading it from this
  machine's own environment variable of the same name rather than storing it
  in the scheduled task definition in plain text.

.PARAMETER AlertKey
  The shared PIPELINE_ALERT_KEY, for failure-only email alerts sent via
  app/api/pipeline-alerts. Defaults to this machine's own
  environment variable of the same name; if that's unset, alerting is just
  skipped — it never blocks or fails the actual pull.

.EXAMPLE
  ./ukl-sales-export-pull.ps1
  Routine daily pull for yesterday, Nairobi branch.
#>

param(
  [string]$Branch = "NAIROBI",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ApiKey = $env:UKL_SALES_EXPORT_KEY,
  [string]$Date = (Get-Date).ToUniversalTime().AddHours(3).ToString("yyyy-MM-dd"),
  [string]$Distributor,
  [string]$AlertKey = $env:PIPELINE_ALERT_KEY
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

# Never throws — a mail-sending hiccup must not turn a good pull into a
# failed one (or mask a real failure). Logs (doesn't throw) and skips if
# AlertKey isn't set — logged rather than silent so "no email arrived" is
# distinguishable from "the key isn't visible in this session yet" (a
# machine-level env var set via [Environment]::SetEnvironmentVariable needs a
# fresh PowerShell window before $env: picks it up here).
function Send-PipelineAlert {
  param([string]$Status, [string]$Summary)
  if (-not $AlertKey) {
    Write-Log "Pipeline alert email skipped: PIPELINE_ALERT_KEY is not set in this session."
    return
  }
  try {
    $payload = @{ task = "ukl-sales-export-pull ($Branch)"; machine = $env:COMPUTERNAME; status = $Status; summary = $Summary } | ConvertTo-Json
    Invoke-RestMethod -Uri "$AppUrl/api/pipeline-alerts" -Method Post -ContentType "application/json" `
      -Headers @{ "x-pipeline-alert-key" = $AlertKey } -Body $payload | Out-Null
  }
  catch {
    Write-Log "Could not send pipeline alert email: $($_.Exception.Message)"
  }
}

if (-not $ApiKey) {
  throw "No API key provided. Pass -ApiKey, or set the UKL_SALES_EXPORT_KEY environment variable on this machine."
}

if (-not $Distributor) {
  $Distributor = switch ($Branch.ToUpperInvariant()) {
    "NAIROBI" { "18048241" }
    "NYERI" { "18058585" }
    default { throw "No distributor mapping for branch '$Branch'. Pass -Distributor explicitly." }
  }
}

$filenameDate = [datetime]::ParseExact($Date, "yyyy-MM-dd", $null).ToString("dd.MM.yyyy")
$destFile = Join-Path $DestFolder "UKL_${Branch}_${filenameDate}.csv"

try {
  Write-Log "Fetching UKL Sales & Returns export for $Date -> $destFile"
  New-Item -ItemType Directory -Path $DestFolder -Force | Out-Null
  Invoke-WebRequest -Uri "$AppUrl/api/integrations/ukl/sales-export?date=$Date&distributor=$Distributor" `
    -Headers @{ "x-ukl-export-key" = $ApiKey } `
    -OutFile $destFile
  $bytes = (Get-Item $destFile).Length
  Write-Log "Saved $bytes bytes to $destFile"
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  Send-PipelineAlert -Status "failure" -Summary "$($_.Exception.Message) (date $Date, branch $Branch)"
  throw
}

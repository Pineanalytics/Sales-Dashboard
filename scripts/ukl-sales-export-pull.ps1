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
  YYYY-MM-DD to export. Defaults to yesterday (Africa/Nairobi, no DST) — the
  source report needs the DMS day fully closed before it's stable, same as
  the sales-returns:sync bridge's own default.

.PARAMETER ApiKey
  The shared UKL_SALES_EXPORT_KEY. Defaults to reading it from this
  machine's own environment variable of the same name rather than storing it
  in the scheduled task definition in plain text.

.EXAMPLE
  ./ukl-sales-export-pull.ps1
  Routine daily pull for yesterday, Nairobi branch.
#>

param(
  [string]$Branch = "NAIROBI",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ApiKey = $env:UKL_SALES_EXPORT_KEY,
  [string]$Date = (Get-Date).ToUniversalTime().AddHours(3).AddDays(-1).ToString("yyyy-MM-dd")
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

if (-not $ApiKey) {
  throw "No API key provided. Pass -ApiKey, or set the UKL_SALES_EXPORT_KEY environment variable on this machine."
}

$filenameDate = [datetime]::ParseExact($Date, "yyyy-MM-dd", $null).ToString("dd.MM.yyyy")
$destFile = Join-Path $DestFolder "UKL_${Branch}_${filenameDate}.csv"

try {
  Write-Log "Fetching UKL Sales & Returns export for $Date -> $destFile"
  New-Item -ItemType Directory -Path $DestFolder -Force | Out-Null
  Invoke-WebRequest -Uri "$AppUrl/api/integrations/ukl/sales-export?date=$Date" `
    -Headers @{ "x-ukl-export-key" = $ApiKey } `
    -OutFile $destFile
  Write-Log "Saved $((Get-Item $destFile).Length) bytes to $destFile"
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  throw
}

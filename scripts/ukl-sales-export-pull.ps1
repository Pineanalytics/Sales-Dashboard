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
  Optional YYYY-MM-DD manual override. When omitted, Smart mode compares a
  branch-scoped VPS manifest with local state, repairs the oldest missing or
  changed CSV, and naturally advances to the latest populated delivery date.

.PARAMETER ReconcileDays
  Calendar-day VPS lookback considered by Smart mode. Defaults to 35 and
  accepts 2-62, matching the Centegy reconciliation guardrail.

.PARAMETER StateFolder
  Stores the branch's small manifest state outside the watched UPLOADS folder.
  Defaults to a sibling STATE folder so the downstream importer never sees it.

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
  Smart five-minute reconciliation for the Nairobi branch.

.EXAMPLE
  ./ukl-sales-export-pull.ps1 -Branch NYERI -Date 2026-08-29
  Manual exact-date refresh for Nyeri.
#>

param(
  [string]$Branch = "NAIROBI",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ApiKey = $env:UKL_SALES_EXPORT_KEY,
  [string]$Date,
  [string]$Distributor,
  [string]$AlertKey = $env:PIPELINE_ALERT_KEY,
  [ValidateRange(2, 62)]
  [int]$ReconcileDays = 35,
  [string]$StateFolder
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

if (-not $StateFolder) {
  $StateFolder = Join-Path (Split-Path -Parent $DestFolder) "STATE"
}

function Get-ExportPath {
  param([string]$ExportDate)
  $filenameDate = [datetime]::ParseExact($ExportDate, "yyyy-MM-dd", $null).ToString("dd.MM.yyyy")
  return Join-Path $DestFolder "UKL_${Branch}_${filenameDate}.csv"
}

function Save-Export {
  param([string]$ExportDate)
  $destFile = Get-ExportPath -ExportDate $ExportDate
  $tempFile = "$destFile.tmp"

  try {
    Write-Log "Fetching UKL Sales & Returns export for $ExportDate -> $destFile"
    New-Item -ItemType Directory -Path $DestFolder -Force | Out-Null
    Invoke-WebRequest -Uri "$AppUrl/api/integrations/ukl/sales-export?date=$ExportDate&distributor=$Distributor" `
      -Headers @{ "x-ukl-export-key" = $ApiKey } `
      -OutFile $tempFile
    $bytes = (Get-Item $tempFile).Length
    # Same-folder rename is atomic on NTFS: the downstream watcher sees either
    # the previous complete CSV or the new complete CSV, never a partial download.
    Move-Item -LiteralPath $tempFile -Destination $destFile -Force
    Write-Log "Saved $bytes bytes to $destFile"
  }
  catch {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
    throw
  }
}

function Read-ManifestState {
  param([string]$Path)
  $known = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $known }
  try {
    $saved = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    foreach ($item in @($saved.days)) {
      if ($item.date -and $item.revision) {
        $known[[string]$item.date] = [pscustomobject]@{
          revision = [string]$item.revision
          sha256 = [string]$item.sha256
        }
      }
    }
    return $known
  }
  catch {
    throw "Could not read manifest state '$Path': $($_.Exception.Message)"
  }
}

function Save-ManifestState {
  param([string]$Path, [hashtable]$Known)
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $days = @($Known.GetEnumerator() | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{
      date = $_.Name
      revision = $_.Value.revision
      sha256 = $_.Value.sha256
    }
  })
  $json = @{ branch = $Branch.ToUpperInvariant(); distributor = $Distributor; days = $days } |
    ConvertTo-Json -Depth 4
  $tempPath = "$Path.tmp"
  [System.IO.File]::WriteAllText($tempPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

try {
  if ($Date) {
    Save-Export -ExportDate $Date
    return
  }

  $manifestUri = "$AppUrl/api/integrations/ukl/sales-export?mode=manifest&distributor=$Distributor&days=$ReconcileDays"
  Write-Log "Checking $Branch export manifest for the latest $ReconcileDays days..."
  $manifest = Invoke-RestMethod -Uri $manifestUri -Headers @{ "x-ukl-export-key" = $ApiKey }
  $availableDays = @($manifest.days | Sort-Object date)
  if ($availableDays.Count -eq 0) {
    Write-Log "No populated VPS delivery dates are available for $Branch yet."
    return
  }

  $stateFile = Join-Path $StateFolder "ukl-sales-export-$($Branch.ToUpperInvariant()).json"
  $known = Read-ManifestState -Path $stateFile
  $repair = $null
  foreach ($day in $availableDays) {
    $localFile = Get-ExportPath -ExportDate ([string]$day.date)
    $knownDay = $known[[string]$day.date]
    $localHash = if (Test-Path -LiteralPath $localFile) {
      (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash
    } else { $null }
    if (-not (Test-Path -LiteralPath $localFile) -or
        -not $knownDay -or
        $knownDay.revision -ne [string]$day.revision -or
        -not $knownDay.sha256 -or
        $knownDay.sha256 -ne $localHash) {
      $repair = $day
      break
    }
  }

  if (-not $repair) {
    Write-Log "All $($availableDays.Count) populated VPS day(s) are current locally; latest is $($manifest.latestDate)."
    return
  }

  Write-Log "Repairing oldest missing or changed local export: $($repair.date) ($($repair.rowCount) VPS rows)."
  Save-Export -ExportDate ([string]$repair.date)
  $repairedFile = Get-ExportPath -ExportDate ([string]$repair.date)
  $known[[string]$repair.date] = [pscustomobject]@{
    revision = [string]$repair.revision
    sha256 = (Get-FileHash -LiteralPath $repairedFile -Algorithm SHA256).Hash
  }
  Save-ManifestState -Path $stateFile -Known $known
  Write-Log "Manifest state updated; any remaining gaps will be handled on the next five-minute run."
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  $scope = if ($Date) { "date $Date" } else { "smart manifest" }
  Send-PipelineAlert -Status "failure" -Summary "$($_.Exception.Message) ($scope, branch $Branch)"
  throw
}

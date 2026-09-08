<#
.SYNOPSIS
  Pulls the UKL Sales & Returns CSV export from the live dashboard and saves
  it into the local folder the downstream upload system already watches —
  replacing the manual "run the SQL report, save as CSV, copy it here" step.

.DESCRIPTION
  Standalone — no dependency on the Sales-Dashboard repo, Node.js, or the
  Centegy DMS SQL Server, since this runs on a third machine (the one hosting
  D:\UKL_INTEGRATION\UPLOADS) with no direct path to either. Only needs
  outbound HTTPS to the dashboard. Every saved export has a monotonically
  increasing, three-digit run sequence for its branch and report date:
  UKL_<BRANCH>_<DD.MM.YYYY>_<NNN>.csv (e.g. UKL_NAIROBI_10.08.2026_001.csv).

.PARAMETER Branch
  Differentiates files once multiple branches (Nairobi, later Nyeri) feed the
  same destination folder. Defaults to NAIROBI, the only branch live today.

.PARAMETER Date
  Optional YYYY-MM-DD manual override. When omitted, Smart mode compares a
  branch-scoped VPS manifest with local state, repairs the oldest missing or
  changed CSV, and naturally advances to the latest populated delivery date.

.PARAMETER ArchiveFolder
  Folder where the downstream watcher moves successfully consumed CSV files.
  Smart mode accepts a matching archived file as delivered instead of treating
  its removal from UPLOADS as a reason to extract it again. Searched recursively.

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

.PARAMETER ClaimQueuedTrigger
  Used only by the dedicated Server-PC trigger task. Claims one
  administrator-selected exact-date export, if any; normal Smart runs are
  unchanged.

.EXAMPLE
  ./ukl-sales-export-pull.ps1
  Smart hourly reconciliation for the Nairobi branch.

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
  [string]$ArchiveFolder,
  [string]$StateFolder,
  [switch]$ClaimQueuedTrigger
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

function Complete-QueuedTrigger {
  param([bool]$Success, [string]$Summary)
  if (-not $script:TriggerId) { return }
  try {
    Invoke-RestMethod -Uri "$AppUrl/api/integrations/ukl/sales-export/trigger/complete" -Method Post -ContentType "application/json" `
      -Headers @{ "x-ukl-export-key" = $ApiKey } `
      -Body (@{ id = $script:TriggerId; success = $Success; summary = $Summary } | ConvertTo-Json -Compress) | Out-Null
  }
  catch {
    Write-Log "Could not report queued-trigger completion: $($_.Exception.Message)"
  }
}

if (-not $ApiKey) {
  throw "No API key provided. Pass -ApiKey, or set the UKL_SALES_EXPORT_KEY environment variable on this machine."
}

$mutex = [Threading.Mutex]::new($false, 'Global\Pinefrost-UklSalesExportPull')
if (-not $mutex.WaitOne(0)) {
  Write-Log 'Another UKL export pull is already running; exiting without claiming or writing a file.'
  exit 0
}

try {
$script:TriggerId = $null
if ($ClaimQueuedTrigger) {
  $pending = Invoke-RestMethod -Uri "$AppUrl/api/integrations/ukl/sales-export/trigger/pending" `
    -Headers @{ "x-ukl-export-key" = $ApiKey }
  if (-not $pending.pending) {
    Write-Log "No queued Server-PC UKL export is waiting."
    exit 0
  }
  $script:TriggerId = [string]$pending.id
  $Branch = [string]$pending.branch
  $Date = [string]$pending.date
  $Distributor = $null
  Write-Log "Claimed queued $Branch export for $Date."
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
if (-not $ArchiveFolder) {
  $ArchiveFolder = Join-Path $DestFolder "Archive"
}

$script:LastSavedExportHash = $null
$script:LastSavedExportPath = $null

function Get-ExportPrefix {
  param([string]$ExportDate)
  $filenameDate = [datetime]::ParseExact($ExportDate, "yyyy-MM-dd", $null).ToString("dd.MM.yyyy")
  return "UKL_$($Branch.ToUpperInvariant())_${filenameDate}"
}

function Get-ExportFiles {
  param([string]$ExportDate)
  $prefix = Get-ExportPrefix -ExportDate $ExportDate
  $files = @()
  if (Test-Path -LiteralPath $DestFolder) {
    $files += @(Get-ChildItem -LiteralPath $DestFolder -Filter "$prefix*.csv" -File -ErrorAction SilentlyContinue)
  }
  if (Test-Path -LiteralPath $ArchiveFolder) {
    $files += @(Get-ChildItem -LiteralPath $ArchiveFolder -Filter "$prefix*.csv" -File -Recurse -ErrorAction SilentlyContinue)
  }
  # Double-quoted PowerShell strings do not interpret backslash escapes, so a
  # literal "\d" (not "\\d") is required here for the regex engine to see a
  # digit-class escape instead of two literal backslashes matching nothing.
  return @($files | Where-Object { $_.Name -match "^$([regex]::Escape($prefix))(_\d+)?\.csv$" })
}

function Get-NextExportPath {
  param([string]$ExportDate)
  $prefix = Get-ExportPrefix -ExportDate $ExportDate
  $pattern = "^$([regex]::Escape($prefix))_(?<sequence>\d+)\.csv$"
  $highestSequence = 0
  foreach ($file in Get-ExportFiles -ExportDate $ExportDate) {
    if ($file.Name -match $pattern) {
      $highestSequence = [Math]::Max($highestSequence, [int]$Matches.sequence)
    }
  }
  return Join-Path $DestFolder ("{0}_{1:D3}.csv" -f $prefix, ($highestSequence + 1))
}

# Guards against a repeat of the 2026-09-07 regression, where doubled
# backslashes in a double-quoted string ("\\d+"/"\\.csv") silently made the
# filter above match nothing: every run then treated every export as
# undelivered and could never advance past "_001", regardless of what was
# already on disk. Run once at startup so a broken pattern fails loudly
# instead of quietly starving the sequence again.
function Assert-ExportFilenamePatternWorks {
  $probeDate = "2026-01-01"
  $probePrefix = Get-ExportPrefix -ExportDate $probeDate
  $probeName = "${probePrefix}_001.csv"
  $filterPattern = "^$([regex]::Escape($probePrefix))(_\d+)?\.csv$"
  $sequencePattern = "^$([regex]::Escape($probePrefix))_(?<sequence>\d+)\.csv$"
  if ($probeName -notmatch $filterPattern -or $probeName -notmatch $sequencePattern) {
    throw "UKL export filename pattern is broken: '$probeName' does not match the expected sequence regex. Check Get-ExportFiles/Get-NextExportPath for accidental double-backslash escaping."
  }
}

Assert-ExportFilenamePatternWorks

function Save-Export {
  param([string]$ExportDate)
  $destFile = Get-NextExportPath -ExportDate $ExportDate
  $tempFile = "$destFile.tmp"

  try {
    Write-Log "Fetching UKL Sales & Returns export for $ExportDate -> $destFile"
    New-Item -ItemType Directory -Path $DestFolder -Force | Out-Null
    Invoke-WebRequest -Uri "$AppUrl/api/integrations/ukl/sales-export?date=$ExportDate&distributor=$Distributor" `
      -Headers @{ "x-ukl-export-key" = $ApiKey } `
      -OutFile $tempFile
    $bytes = (Get-Item $tempFile).Length
    $script:LastSavedExportHash = (Get-FileHash -LiteralPath $tempFile -Algorithm SHA256).Hash
    # Same-folder rename is atomic on NTFS: the downstream watcher sees either
    # the previous complete CSV or the new complete CSV, never a partial download.
    Move-Item -LiteralPath $tempFile -Destination $destFile -Force
    $script:LastSavedExportPath = $destFile
    Write-Log "Saved $bytes bytes to $destFile"
  }
  catch {
    if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue }
    throw
  }
}

function Find-DeliveredFile {
  param([string]$ExportDate, [string]$ExpectedHash)
  foreach ($candidate in @(Get-ExportFiles -ExportDate $ExportDate | Sort-Object LastWriteTimeUtc -Descending)) {
    $hash = (Get-FileHash -LiteralPath $candidate.FullName -Algorithm SHA256).Hash
    if (-not $ExpectedHash -or $hash -eq $ExpectedHash) {
      return [pscustomobject]@{ path = $candidate.FullName; sha256 = $hash; lastWriteTimeUtc = $candidate.LastWriteTimeUtc }
    }
  }
  return $null
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

  if ($Date) {
    Save-Export -ExportDate $Date
    Complete-QueuedTrigger -Success $true -Summary "Saved $(Split-Path -Leaf $script:LastSavedExportPath) for $Branch on $Date."
    return
  }

  $nairobiNow = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(3))
  $today = $nairobiNow.ToString("yyyy-MM-dd")
  $yesterday = $nairobiNow.AddDays(-1).ToString("yyyy-MM-dd")
  $afterPreviousDayCutoff = $nairobiNow.Hour -ge 6
  $manifestUri = "$AppUrl/api/integrations/ukl/sales-export?mode=manifest&distributor=$Distributor&from=$yesterday&to=$today"
  $previousDayMode = if ($afterPreviousDayCutoff) { "late-change detection only" } else { "close-period reconciliation until 06:00" }
  Write-Log "Checking $Branch export manifest: today $today first; yesterday $yesterday is $previousDayMode."
  $manifest = Invoke-RestMethod -Uri $manifestUri -Headers @{ "x-ukl-export-key" = $ApiKey }
  # Today is operationally urgent. Descending order also prevents a changing
  # previous-day partition from starving today's export.
  $availableDays = @($manifest.days | Sort-Object date -Descending)
  if ($availableDays.Count -eq 0) {
    Write-Log "No populated VPS delivery dates are available for $Branch yet."
    return
  }

  $stateFile = Join-Path $StateFolder "ukl-sales-export-$($Branch.ToUpperInvariant()).json"
  $known = Read-ManifestState -Path $stateFile
  $stateChanged = $false
  $repairs = @()
  foreach ($day in $availableDays) {
    $knownDay = $known[[string]$day.date]
    $delivered = Find-DeliveredFile -ExportDate ([string]$day.date) -ExpectedHash $(if ($knownDay) { $knownDay.sha256 } else { $null })
    $revisionMatches = $knownDay -and $knownDay.revision -eq [string]$day.revision
    if ($revisionMatches -and $delivered -and $knownDay.sha256 -eq $delivered.sha256) {
      continue
    }
    if (-not $knownDay -and $delivered) {
      $remoteUpdatedAt = [DateTimeOffset]::Parse([string]$day.lastReplacedAt).UtcDateTime
      if ($delivered.lastWriteTimeUtc -ge $remoteUpdatedAt) {
        $known[[string]$day.date] = [pscustomobject]@{ revision = [string]$day.revision; sha256 = $delivered.sha256 }
        $stateChanged = $true
        Write-Log "Confirmed existing delivered export for $($day.date) at $($delivered.path)."
        continue
      }
    }
    if (-not $revisionMatches -or -not $delivered) {
      $repairs += $day
    }
  }

  if ($repairs.Count -eq 0) {
    if ($stateChanged) { Save-ManifestState -Path $stateFile -Known $known }
    Write-Log "All $($availableDays.Count) populated VPS day(s) are current locally; latest is $($manifest.latestDate)."
    return
  }

  foreach ($repair in $repairs) {
    $isPreviousDay = [string]$repair.date -ne $today
    if ($isPreviousDay -and $afterPreviousDayCutoff) {
      Write-Log "Late previous-day change detected after 06:00; replacing $($repair.date) automatically."
    }
    Write-Log "Repairing missing or content-changed local export: $($repair.date) ($($repair.rowCount) VPS rows)."
    Save-Export -ExportDate ([string]$repair.date)
    $known[[string]$repair.date] = [pscustomobject]@{
      revision = [string]$repair.revision
      sha256 = $script:LastSavedExportHash
    }
    # Persist after each file. If the second download fails, the completed
    # first file is not needlessly repeated on the next hourly run.
    Save-ManifestState -Path $stateFile -Known $known
  }
  Write-Log "Manifest state updated for all $($repairs.Count) changed day(s)."
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  $scope = if ($Date) { "date $Date" } else { "smart manifest" }
  Send-PipelineAlert -Status "failure" -Summary "$($_.Exception.Message) ($scope, branch $Branch)"
  Complete-QueuedTrigger -Success $false -Summary $_.Exception.Message
  throw
}
finally {
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}

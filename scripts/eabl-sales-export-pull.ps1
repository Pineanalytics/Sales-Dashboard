<#
.SYNOPSIS
  Archive-aware EABL sales export downloader. Run by Task Scheduler every five minutes.

.DESCRIPTION
  Smart mode considers exactly yesterday and today in Africa/Nairobi. -Date is
  an exact, explicit backfill; it never turns into a month scan. New files are
  written only to DestFolder, never to ArchiveFolder.
#>
param(
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$DestFolder = "D:\EABL_SALES_EXPORT",
  [string]$ArchiveFolder,
  [string]$StateFolder,
  [string]$ApiKey = $env:EABL_SALES_EXPORT_KEY,
  [string]$AlertKey = $env:PIPELINE_ALERT_KEY,
  [string]$Date,
  [ValidateSet('Smart', 'Today', 'Close')]
  [string]$ScheduleMode = 'Smart',
  [switch]$Replace
)

$ErrorActionPreference = "Stop"
$ReportName = "eabl-sales-export"
$ExpectedFields = 22
function Write-Log([string]$message) { Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $message) }
function Assert-Date([string]$value) {
  if ($value -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Date must be YYYY-MM-DD." }
  try { $parsed = [datetime]::ParseExact($value, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture); if ($parsed.ToString('yyyy-MM-dd') -ne $value) { throw 'invalid' }; return $parsed } catch { throw "Date '$value' is not a real calendar date." }
}
function Get-FileName([string]$value) { return "EABL_$((Assert-Date $value).ToString('yyyyMMdd')).csv" }
function Send-PipelineAlert([string]$stage, [string]$message, [string]$date) {
  if (-not $AlertKey) { Write-Log 'Alert skipped: PIPELINE_ALERT_KEY is not available in this process.'; return }
  try {
    $body = @{ task = $ReportName; machine = $env:COMPUTERNAME; status = 'failure'; summary = "date=$date; stage=$stage; $message" } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$AppUrl/api/pipeline-alerts" -Method Post -ContentType 'application/json' -Headers @{ 'x-pipeline-alert-key' = $AlertKey } -Body $body | Out-Null
  } catch { Write-Log "Alert delivery failed: $($_.Exception.Message)" }
}
function Send-Status([string]$status, [string]$lastError, [string]$lastFile, [string]$location, [string]$availableDate) {
  try {
    $body = @{ machine=$env:COMPUTERNAME; status=$status; lastError=$lastError; lastDeliveredFile=$lastFile; deliveredLocation=$location; latestAvailableReportDate=$availableDate; lastSuccessfulDownloadAt=if ($status -eq 'OK') { [datetime]::UtcNow.ToString('o') } else { $null }; nextScheduledRunAt=[datetime]::UtcNow.AddMinutes(5).ToString('o') } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export/status" -Method Post -ContentType 'application/json' -Headers @{ 'x-eabl-sales-export-key' = $ApiKey } -Body $body | Out-Null
  } catch { Write-Log "Status update failed: $($_.Exception.Message)" }
}
function Read-State([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{} }
  try {
    $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $result = @{}; foreach ($day in @($state.days)) { if ($day.date) { $result[[string]$day.date] = $day } }; return $result
  } catch { throw "State file is invalid: $path. $($_.Exception.Message)" }
}
function Save-State([string]$path, [hashtable]$state) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $payload = @{ report = $ReportName; updatedAt = [datetime]::UtcNow.ToString('o'); days = @($state.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Value }) } | ConvertTo-Json -Depth 5
  $tmp = "$path.tmp"; [io.file]::WriteAllText($tmp, $payload, [Text.UTF8Encoding]::new($false)); Move-Item -LiteralPath $tmp -Destination $path -Force
}
function Find-Delivered([string]$date, [string]$expectedHash) {
  $name = Get-FileName $date; $matches = @(); $live = Join-Path $DestFolder $name
  if (Test-Path -LiteralPath $live) { $matches += Get-Item -LiteralPath $live }
  if (Test-Path -LiteralPath $ArchiveFolder) { $matches += @(Get-ChildItem -LiteralPath $ArchiveFolder -Filter $name -File -Recurse -ErrorAction SilentlyContinue) }
  foreach ($file in @($matches | Sort-Object LastWriteTimeUtc -Descending)) {
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $expectedHash -or $hash -eq $expectedHash.ToLowerInvariant()) { return [pscustomobject]@{ path=$file.FullName; sha256=$hash; location=if ($file.FullName.StartsWith($ArchiveFolder, [StringComparison]::OrdinalIgnoreCase)) { 'Archive' } else { 'Root' } } }
  }
  return $null
}
function Test-HeaderlessCsv([string]$path, [string]$date) {
  $item = Get-Item -LiteralPath $path
  if ($item.Length -le 0) { throw 'Downloaded file is empty.' }
  $probe = [Text.Encoding]::UTF8.GetString([io.file]::ReadAllBytes($path), 0, [Math]::Min(512, $item.Length))
  if ($probe.TrimStart() -match '^(?i:<(!doctype|html|head|body))') { throw 'Downloaded file looks like HTML, not CSV.' }
  # The receiver's established file format is headerless, so validate CSV
  # structure (22 fields) rather than inventing a header that would break it.
  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($path)
  try {
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited; $parser.SetDelimiters(',')
    $count = 0; while (-not $parser.EndOfData) { $fields = $parser.ReadFields(); if ($fields.Count -ne $ExpectedFields) { throw "CSV row $($count + 1) has $($fields.Count) fields; expected $ExpectedFields." }; $count++ }
    if ($count -eq 0) { throw 'CSV contains no rows.' }; return $count
  } finally { $parser.Close() }
}
function Download-Day([string]$date, [string]$revision) {
  $filename = Get-FileName $date; $destination = Join-Path $DestFolder $filename; $temp = Join-Path $DestFolder ".${filename}.$PID.tmp"
  New-Item -ItemType Directory -Force -Path $DestFolder | Out-Null
  try {
    Write-Log "Downloading $date to temporary file."
    Invoke-WebRequest -Uri "$AppUrl/api/integrations/eabl/sales-export?date=$date" -Headers @{ 'x-eabl-sales-export-key' = $ApiKey } -OutFile $temp
    $rows = Test-HeaderlessCsv -path $temp -date $date
    $hash = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
    # Same-volume rename is atomic. An existing file is replaced only when the
    # manifest says the revision changed or an explicit -Replace was supplied.
    Move-Item -LiteralPath $temp -Destination $destination -Force
    Write-Log "Delivered $filename ($rows rows, $hash)."
    return [pscustomobject]@{ date=$date; revision=$revision; filename=$filename; sha256=$hash; rowCount=$rows; deliveredAt=[datetime]::UtcNow.ToString('o') }
  } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue } }
}
function Reconcile-ManifestDay($day, [hashtable]$known) {
  $date = [string]$day.date
  if ($day.rowCount -le 0) { return [pscustomobject]@{ date=$date; available=$false; changed=$false; record=$null } }
  $prior = $known[$date]
  $delivered = Find-Delivered $date $(if ($prior) { [string]$prior.sha256 } else { $null })
  if ($prior -and $prior.revision -eq $day.revision -and $delivered -and $delivered.sha256 -eq $prior.sha256) {
    return [pscustomobject]@{ date=$date; available=$true; changed=$false; record=$prior }
  }
  $record = Download-Day $date ([string]$day.revision)
  $known[$date] = $record
  return [pscustomobject]@{ date=$date; available=$true; changed=$true; record=$record }
}

if (-not $ApiKey) { throw 'Set the EABL_SALES_EXPORT_KEY machine environment variable; do not place it in this script or task definition.' }
if (-not $ArchiveFolder) { $ArchiveFolder = Join-Path $DestFolder 'Archive' }
if (-not $StateFolder) { $StateFolder = Join-Path (Split-Path -Parent $DestFolder) 'EABL_SALES_EXPORT_STATE' }
$stateFile = Join-Path $StateFolder 'eabl-sales-export-state.json'
$mutex = [Threading.Mutex]::new($false, 'Global\Pinefrost-EablSalesExportPull')
if (-not $mutex.WaitOne(0)) { Write-Log 'Another EABL download is already running; exiting.'; exit 0 }
try {
  $triggerId = $null
  if (-not $Date) {
    $pending = Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export/trigger/pending" -Headers @{ 'x-eabl-sales-export-key' = $ApiKey }
    if ($pending.request) {
      $triggerId = [string]$pending.request.id
      if ([string]$pending.request.mode -eq 'DATE') { $Date = [string]$pending.request.date; $Replace = $true; Write-Log "Claimed administrator-approved exact-date request $Date." }
      else { Write-Log 'Claimed manual Smart request.' }
    }
  }
  if ($Date) {
    [void](Assert-Date $Date); $known = Read-State $stateFile; $existing = Find-Delivered $Date $(if ($known[$Date]) { [string]$known[$Date].sha256 } else { $null })
    if ($existing -and -not $Replace) { throw "A delivered file already exists at $($existing.path). Use -Replace only for this exact manual date." }
    $record = Download-Day $Date $(if ($known[$Date]) { [string]$known[$Date].revision } else { 'manual' }); $known[$Date] = $record; Save-State $stateFile $known
    Send-Status 'OK' $null $record.filename 'Root' $Date
    if ($triggerId) { Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export/trigger/complete" -Method Post -ContentType 'application/json' -Headers @{ 'x-eabl-sales-export-key' = $ApiKey } -Body (@{ id=$triggerId; success=$true; summary="Delivered $($record.filename)" } | ConvertTo-Json -Compress) | Out-Null }
    exit 0
  }
  $now = [datetimeoffset]::UtcNow.ToOffset([timespan]::FromHours(3)); $today = $now.ToString('yyyy-MM-dd'); $yesterday = $now.AddDays(-1).ToString('yyyy-MM-dd')
  # Today mode is used by the 09:00–21:00 hourly task. It never inspects
  # yesterday. Close mode (22:00) is the sole scheduled reconciliation that
  # verifies yesterday's final export and alerts if it is unavailable.
  $from = if ($ScheduleMode -eq 'Today') { $today } else { $yesterday }
  $manifest = Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export?mode=manifest&from=$from&to=$today" -Headers @{ 'x-eabl-sales-export-key' = $ApiKey }
  $known = Read-State $stateFile
  $byDate = @{}; foreach ($day in @($manifest.days)) { $byDate[[string]$day.date] = $day }
  if ($ScheduleMode -eq 'Close') {
    $yesterdayDay = $byDate[$yesterday]
    if (-not $yesterdayDay -or $yesterdayDay.rowCount -le 0) {
      throw "FINAL_YESTERDAY_MISSING: VPS has no qualifying EABL sales rows for $yesterday at the 22:00 close check."
    }
    $yesterdayResult = Reconcile-ManifestDay $yesterdayDay $known
    if ($yesterdayResult.changed) { Save-State $stateFile $known }
  }

  $todayDay = $byDate[$today]
  if ($todayDay) {
    $todayResult = Reconcile-ManifestDay $todayDay $known
    if ($todayResult.changed) { Save-State $stateFile $known }
  }
  Send-Status 'OK' $null $null $null $today
  if ($triggerId) { Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export/trigger/complete" -Method Post -ContentType 'application/json' -Headers @{ 'x-eabl-sales-export-key' = $ApiKey } -Body (@{ id=$triggerId; success=$true; summary='Smart reconciliation completed.' } | ConvertTo-Json -Compress) | Out-Null }
  Write-Log "$ScheduleMode reconciliation completed."
} catch {
  $failedDate = if ($Date) { $Date } else { 'today/yesterday' }; Write-Log "FAILED: $($_.Exception.Message)"; Send-Status 'FAILED' $_.Exception.Message $null $null $failedDate; Send-PipelineAlert 'download-or-validation' $_.Exception.Message $failedDate
  if ($triggerId) { try { Invoke-RestMethod -Uri "$AppUrl/api/integrations/eabl/sales-export/trigger/complete" -Method Post -ContentType 'application/json' -Headers @{ 'x-eabl-sales-export-key' = $ApiKey } -Body (@{ id=$triggerId; success=$false; summary=$_.Exception.Message } | ConvertTo-Json -Compress) | Out-Null } catch { Write-Log "Could not complete trigger: $($_.Exception.Message)" } }
  exit 1
} finally { if ($mutex) { $mutex.ReleaseMutex() | Out-Null; $mutex.Dispose() } }

# A successful Smart run may not invoke a native executable, leaving
# $LASTEXITCODE inherited from the hosting PowerShell session. Set the process
# result explicitly so Task Scheduler and the installer can distinguish a
# completed reconciliation from a real failure.
exit 0

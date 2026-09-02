<#
.SYNOPSIS
  Installs the EABL timetable on the dedicated download machine.

.DESCRIPTION
  - 09:05 through 21:05 Africa/Nairobi: Today-only reconciliation, hourly,
    after the hourly VPS upload has had time to complete.
  - 22:05 Africa/Nairobi: final Today reconciliation and mandatory Yesterday
    reconciliation. Missing or failed yesterday data causes a failure-only
    pipeline email alert.
#>
param(
  [string]$ScriptPath = "C:\EablSalesExportPull.ps1",
  [string]$DestFolder = "D:\EABL_INTEGRATION\UPLOADS",
  [string]$ArchiveFolder = "D:\EABL_INTEGRATION\UPLOADS\Archive",
  [string]$StateFolder = "D:\EABL_INTEGRATION\EABL_SALES_EXPORT_STATE",
  [string]$TodayTaskName = "Pinefrost EABL Sales Export Today",
  [string]$CloseTaskName = "Pinefrost EABL Sales Export Close"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Missing EABL puller: $ScriptPath" }
if (-not [Environment]::GetEnvironmentVariable('EABL_SALES_EXPORT_KEY', 'Machine')) { throw 'EABL_SALES_EXPORT_KEY is not set at machine scope.' }

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
function New-EablAction([string]$mode) {
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -ScheduleMode $mode -DestFolder `"$DestFolder`" -ArchiveFolder `"$ArchiveFolder`" -StateFolder `"$StateFolder`""
  return New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
}

# Replace the old five-minute task and any prior timetable tasks.
@('Pinefrost EABL Sales Export Pull', $TodayTaskName, $CloseTaskName) | ForEach-Object {
  Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue
}

$todayTriggers = @(9..21 | ForEach-Object { New-ScheduledTaskTrigger -Daily -At ("{0:00}:05" -f $_) })
Register-ScheduledTask -TaskName $TodayTaskName -Action (New-EablAction 'Today') -Trigger $todayTriggers -Settings $settings -Principal $principal -Description 'EABL today-only hourly exports, 09:05–21:05 Africa/Nairobi, after VPS upload.' -Force | Out-Null
Register-ScheduledTask -TaskName $CloseTaskName -Action (New-EablAction 'Close') -Trigger (New-ScheduledTaskTrigger -Daily -At '22:05') -Settings $settings -Principal $principal -Description 'EABL 22:05 final today + mandatory yesterday reconciliation, after VPS upload.' -Force | Out-Null

Get-ScheduledTask -TaskName $TodayTaskName, $CloseTaskName | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

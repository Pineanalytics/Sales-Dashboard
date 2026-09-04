<#
.SYNOPSIS
  Replaces the Server-PC UKL branch pull schedules with serialized hourly runs.

.DESCRIPTION
  Nairobi starts at :05 and Nyeri at :25 in Africa/Nairobi. Both invoke the
  same puller, whose named mutex prevents concurrent access to the watched
  folder and state files. A missed or busy run is safely retried on the next
  hourly pass; this installer never changes the downstream consumer.
#>
param(
  [string]$ScriptPath = "C:\ukl-sales-export-pull.ps1",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ArchiveFolder = "D:\UKL_INTEGRATION\UPLOADS\Archive",
  [string]$StateFolder = "D:\UKL_INTEGRATION\STATE",
  [string]$NairobiTaskName = "UKL-SalesExport-Pull",
  [string]$NyeriTaskName = "UKL-SalesExport-Pull-Nyeri"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Missing UKL puller: $ScriptPath" }
if (-not [Environment]::GetEnvironmentVariable('UKL_SALES_EXPORT_KEY', 'Machine')) { throw 'UKL_SALES_EXPORT_KEY is not set at machine scope.' }

function Get-NextHourlyTime([int]$Minute) {
  $now = Get-Date
  $next = Get-Date -Hour $now.Hour -Minute $Minute -Second 0
  if ($next -le $now) { $next = $next.AddHours(1) }
  return $next
}
function New-UklAction([string]$Branch) {
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Branch $Branch -DestFolder `"$DestFolder`" -ArchiveFolder `"$ArchiveFolder`" -StateFolder `"$StateFolder`""
  return New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
}
function New-UklHourlyTrigger([int]$Minute) {
  return New-ScheduledTaskTrigger -Once -At (Get-NextHourlyTime $Minute) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $NairobiTaskName -Action (New-UklAction 'NAIROBI') -Trigger (New-UklHourlyTrigger 5) -Settings $settings -Principal $principal -Description 'UKL Nairobi Sales & Returns export, hourly at :05 Africa/Nairobi.' -Force | Out-Null
Register-ScheduledTask -TaskName $NyeriTaskName -Action (New-UklAction 'NYERI') -Trigger (New-UklHourlyTrigger 25) -Settings $settings -Principal $principal -Description 'UKL Nyeri Sales & Returns export, hourly at :25 Africa/Nairobi.' -Force | Out-Null

Get-ScheduledTask -TaskName $NairobiTaskName, $NyeriTaskName | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

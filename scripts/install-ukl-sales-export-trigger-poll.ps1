<#
.SYNOPSIS
  Installs the Server-PC poll for administrator-selected UKL Sales & Returns
  export months.

.DESCRIPTION
  The dashboard cannot initiate a connection into the Server PC. This task
  runs locally once per hour, claims at most one queued exact-date job,
  and invokes the existing UKL puller. Its task setting ignores overlaps, so
  a slow download never runs two extracts concurrently.
#>
param(
  [string]$ScriptPath = "C:\ukl-sales-export-pull.ps1",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ArchiveFolder = "D:\UKL_INTEGRATION\UPLOADS\Archive",
  [string]$StateFolder = "D:\UKL_INTEGRATION\UKL_SALES_EXPORT_STATE",
  [string]$TaskName = "Pinefrost UKL Sales Export Trigger Poll"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Missing UKL puller: $ScriptPath" }
if (-not [Environment]::GetEnvironmentVariable('UKL_SALES_EXPORT_KEY', 'Machine')) { throw 'UKL_SALES_EXPORT_KEY is not set at machine scope.' }

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -ClaimQueuedTrigger -DestFolder `"$DestFolder`" -ArchiveFolder `"$ArchiveFolder`" -StateFolder `"$StateFolder`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
function Get-NextHourlyTime([int]$Minute) {
  $now = Get-Date
  $next = Get-Date -Hour $now.Hour -Minute $Minute -Second 0
  if ($next -le $now) { $next = $next.AddHours(1) }
  return $next
}
$trigger = New-ScheduledTaskTrigger -Once -At (Get-NextHourlyTime 45) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Claims one administrator-selected UKL Sales & Returns Server-PC export each hour at :45.' -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

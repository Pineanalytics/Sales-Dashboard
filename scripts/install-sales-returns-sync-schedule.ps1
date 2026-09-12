<#
.SYNOPSIS
  Installs the single five-minute Smart Sales & Returns task for a Centegy PC.

.DESCRIPTION
  Retires the former Morning, Midday, Evening, and FiveMinute schedules. They
  all called the same bridge and could overlap the Smart task. The bridge also
  owns a machine-wide mutex, but keeping only this canonical task makes the
  schedule auditable and avoids unnecessary source/database load.
#>

param(
  [string]$ProjectPath = "C:\SalesDashboard",
  [string]$TaskName = "SalesDashboard-SalesReturnsSync-Smart"
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $ProjectPath "scripts\sales-returns-sync.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing Sales & Returns sync script: $scriptPath" }

function Get-NextFiveMinuteBoundary {
  $now = Get-Date
  $minute = [math]::Floor($now.Minute / 5) * 5 + 5
  $next = Get-Date -Hour $now.Hour -Minute 0 -Second 0
  return $next.AddMinutes($minute)
}

$legacyTaskNames = @(
  "SalesDashboard-SalesReturnsSync-Morning",
  "SalesDashboard-SalesReturnsSync-Midday",
  "SalesDashboard-SalesReturnsSync-Evening",
  "SalesDashboard-SalesReturnsSync-FiveMinute"
)
foreach ($legacyTaskName in $legacyTaskNames) {
  Disable-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue | Out-Null
}

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectPath `"$ProjectPath`" -Window Smart"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -Once -At (Get-NextFiveMinuteBoundary) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Sales & Returns Smart reconciliation every five minutes; legacy overlapping tasks disabled." -Force | Out-Null

Get-ScheduledTask -TaskName ($legacyTaskNames + $TaskName) |
  Select-Object TaskName, State |
  Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $TaskName |
  Format-List LastRunTime, LastTaskResult, NextRunTime

<#
.SYNOPSIS
  Installs the single five-minute Smart Sales & Returns task for a Centegy PC.

.DESCRIPTION
  Retires the former Morning, Midday, Evening, and FiveMinute schedules. They
  all called the same bridge and could overlap the Smart task. The bridge also
  owns a machine-wide mutex, but keeping only this canonical task makes the
  schedule auditable and avoids unnecessary source/database load.

  Both this task and TriggerPoll launch through scripts/run-hidden.vbs rather
  than invoking powershell.exe directly with -WindowStyle Hidden — that flag
  alone does not reliably suppress the console window on Task Scheduler
  (confirmed live: a visible window kept popping up on every five-minute run
  on a Centegy PC even with -WindowStyle Hidden already set).
#>

param(
  [string]$ProjectPath = "C:\SalesDashboard",
  [string]$TaskName = "SalesDashboard-SalesReturnsSync-Smart"
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $ProjectPath "scripts\sales-returns-sync.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing Sales & Returns sync script: $scriptPath" }
$hiddenRunnerPath = Join-Path $ProjectPath "scripts\run-hidden.vbs"
if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) { throw "Missing hidden-runner wrapper: $hiddenRunnerPath" }

# powershell.exe's own -WindowStyle Hidden does not reliably suppress the
# console window on Task Scheduler (a brief flash, or on some machines a
# fully visible window, on every run - confirmed live on this task) since
# conhost.exe allocates a window before -WindowStyle is ever parsed. Routes
# every action through run-hidden.vbs (WScript.Shell.Run, windowStyle=0)
# instead, which never allocates a window at all. Each token is its own
# argument (not pre-joined into one string) so nested-quote escaping is
# never a concern here.
function New-HiddenAction([string[]]$CommandParts) {
  $quoted = $CommandParts | ForEach-Object { "`"$_`"" }
  $argumentText = "`"$hiddenRunnerPath`" " + ($quoted -join " ")
  return New-ScheduledTaskAction -Execute "wscript.exe" -Argument $argumentText
}

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

$action = New-HiddenAction @("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $scriptPath, "-ProjectPath", $ProjectPath, "-Window", "Smart")
$trigger = New-ScheduledTaskTrigger -Once -At (Get-NextFiveMinuteBoundary) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Sales & Returns Smart reconciliation every five minutes, silently in the background; legacy overlapping tasks disabled." -Force | Out-Null

# TriggerPoll is a separate, optional task used to claim dashboard-queued
# selected-date runs. Keep its existing trigger/settings, but ensure it cannot
# show a console window every time it polls.
$triggerPollTaskName = 'SalesDashboard-TriggerPoll'
$triggerPollScriptPath = Join-Path $ProjectPath 'scripts\sales-returns-trigger-poll.ps1'
if ((Get-ScheduledTask -TaskName $triggerPollTaskName -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $triggerPollScriptPath)) {
  $triggerPollAction = New-HiddenAction @("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $triggerPollScriptPath, "-ProjectPath", $ProjectPath)
  Set-ScheduledTask -TaskName $triggerPollTaskName -Action $triggerPollAction | Out-Null
}

Get-ScheduledTask -TaskName ($legacyTaskNames + $TaskName) |
  Select-Object TaskName, State |
  Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $TaskName |
  Format-List LastRunTime, LastTaskResult, NextRunTime

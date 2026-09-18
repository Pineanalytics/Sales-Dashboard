<#
.SYNOPSIS
  Installs the Order 360 daily sync as a Windows Task Scheduler job.

.DESCRIPTION
  scripts/order-360-sync.ps1 has always documented this schedule (Daily at
  18:30 Africa/Nairobi) in its own header comment, but — unlike EABL, UKL,
  and Sales & Returns — nothing in this repository ever actually installed
  it; it was left to be created by hand on whichever machine runs it. That
  meant a machine rebuild, or the task simply never having been created,
  would silently stop Order 360 data from syncing with no error anywhere
  in the dashboard (fixed separately: lib/syncHealth.ts now surfaces this
  bridge's SyncWatermark on the Sync Health page instead of nowhere).

  Run this once on the machine that has SQLBRIDGE_COVERAGE_MYSQL_* network
  access to the Pine MySQL source and this repository checked out at
  $ProjectPath (same source/credentials as Active Outlets and Timestamps —
  see docs/automation-registry.md).

.PARAMETER ProjectPath
  Where this repository is checked out on the scheduling machine. Must
  match scripts/order-360-sync.ps1's own -ProjectPath default/usage.

.PARAMETER TaskName
  Windows Task Scheduler task name. Replaces any existing task of the same
  name so re-running this script is always safe.
#>
param(
  [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard",
  [string]$TaskName = "Pinefrost Order 360 Sync"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $ProjectPath "scripts\order-360-sync.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing Order 360 sync wrapper: $scriptPath" }

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
# A longer execution limit than EABL/UKL's pullers: the very first run backfills
# the trailing 3 months (scripts/db-bridge/order-360/run.ts decides this itself
# from the saved SyncWatermark), which can take meaningfully longer than every
# routine top-up-only run after it.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At '18:30'

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Order 360 daily sync (trailing-window incremental; backfills trailing 3 months on first run), 18:30 Africa/Nairobi.' -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

<#
.SYNOPSIS
  Installs serialized UKL Server-PC extraction schedules with an afternoon boost.

.DESCRIPTION
  Outside the sales-submission window, Nairobi runs hourly at :05 and Nyeri
  at :25. From 14:00 through 17:59 Africa/Nairobi, each branch extracts every
  ten minutes instead: Nairobi at :00/:10/.../:50, Nyeri at :05/:15/.../:55.
  The five-minute branch offset preserves the puller's single mutex and avoids
  two writers touching the watched folder at the same time. Normal hourly
  extraction resumes automatically at 18:05 (Nairobi) and 18:25 (Nyeri).
#>
param(
  [string]$ScriptPath = "C:\ukl-sales-export-pull.ps1",
  [string]$DestFolder = "D:\UKL_INTEGRATION\UPLOADS",
  [string]$ArchiveFolder = "D:\UKL_INTEGRATION\UPLOADS\Archive",
  [string]$StateFolder = "D:\UKL_INTEGRATION\UKL_SALES_EXPORT_STATE",
  [string]$NairobiTaskName = "UKL-SalesExport-Pull",
  [string]$NyeriTaskName = "UKL-SalesExport-Pull-Nyeri",
  [string]$NairobiBoostTaskName = "UKL-SalesExport-Pull-Nairobi-Boost",
  [string]$NyeriBoostTaskName = "UKL-SalesExport-Pull-Nyeri-Boost"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Missing UKL puller: $ScriptPath" }
if (-not [Environment]::GetEnvironmentVariable('UKL_SALES_EXPORT_KEY', 'Machine')) { throw 'UKL_SALES_EXPORT_KEY is not set at machine scope.' }

function New-UklAction([string]$Branch) {
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Branch $Branch -DestFolder `"$DestFolder`" -ArchiveFolder `"$ArchiveFolder`" -StateFolder `"$StateFolder`""
  return New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
}
function New-UklDailyTrigger([int]$Hour, [int]$Minute) {
  return New-ScheduledTaskTrigger -Daily -At ("{0:00}:{1:00}" -f $Hour, $Minute)
}
function New-UklNormalHourlyTriggers([int]$Minute) {
  # 14:00–17:59 is intentionally excluded: the separate Boost task owns
  # that window, so an hourly trigger cannot create a duplicate extraction.
  $normalHours = @(0..13) + @(18..23)
  return @($normalHours | ForEach-Object { New-UklDailyTrigger -Hour $_ -Minute $Minute })
}
function New-UklBoostTriggers([int]$MinuteOffset) {
  $triggers = @()
  foreach ($hour in 14..17) {
    foreach ($minute in $MinuteOffset, ($MinuteOffset + 10), ($MinuteOffset + 20), ($MinuteOffset + 30), ($MinuteOffset + 40), ($MinuteOffset + 50)) {
      $triggers += New-UklDailyTrigger -Hour $hour -Minute $minute
    }
  }
  return $triggers
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $NairobiTaskName -Action (New-UklAction 'NAIROBI') -Trigger (New-UklNormalHourlyTriggers 5) -Settings $settings -Principal $principal -Description 'UKL Nairobi Sales & Returns export, hourly at :05 outside the 14:00–18:00 boost window.' -Force | Out-Null
Register-ScheduledTask -TaskName $NyeriTaskName -Action (New-UklAction 'NYERI') -Trigger (New-UklNormalHourlyTriggers 25) -Settings $settings -Principal $principal -Description 'UKL Nyeri Sales & Returns export, hourly at :25 outside the 14:00–18:00 boost window.' -Force | Out-Null
Register-ScheduledTask -TaskName $NairobiBoostTaskName -Action (New-UklAction 'NAIROBI') -Trigger (New-UklBoostTriggers 0) -Settings $settings -Principal $principal -Description 'UKL Nairobi Sales & Returns export every 10 minutes, 14:00–18:00 Africa/Nairobi.' -Force | Out-Null
Register-ScheduledTask -TaskName $NyeriBoostTaskName -Action (New-UklAction 'NYERI') -Trigger (New-UklBoostTriggers 5) -Settings $settings -Principal $principal -Description 'UKL Nyeri Sales & Returns export every 10 minutes, 14:00–18:00 Africa/Nairobi.' -Force | Out-Null

Get-ScheduledTask -TaskName $NairobiTaskName, $NyeriTaskName, $NairobiBoostTaskName, $NyeriBoostTaskName |
  Get-ScheduledTaskInfo |
  Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime -AutoSize

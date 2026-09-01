<# Run as Administrator on the dedicated download machine after copying
eabl-sales-export-pull.ps1 to C:\EablSalesExportPull.ps1. #>
param(
  [string]$ScriptPath = "C:\EablSalesExportPull.ps1",
  [string]$TaskName = "Pinefrost EABL Sales Export Pull"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Missing downloader: $ScriptPath" }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Downloads EABL today/yesterday sales files from Pinefrost VPS.' -Force | Out-Null
Write-Output "Installed '$TaskName'. It runs only in the account used to register it; use a least-privilege account with write access to the configured destination."

<# Run as Administrator on the DataEdge source machine. Pass the exact name
of its existing uploader task; this adds a separate outbound-only poller. #>
param(
  [Parameter(Mandatory = $true)][string]$DataEdgeTaskName,
  [string]$ScriptPath = "C:\UpfieldDataEdgeTriggerPoll.ps1",
  [string]$TaskName = "Pinefrost Upfield DataEdge Trigger Poll"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Copy upfield-dataedge-trigger-poll.ps1 to $ScriptPath first." }
if (-not (Get-ScheduledTask -TaskName $DataEdgeTaskName -ErrorAction SilentlyContinue)) { throw "No existing task named '$DataEdgeTaskName' was found." }
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`" -DataEdgeTaskName `"$DataEdgeTaskName`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Polls queued dashboard-triggered Upfield DataEdge syncs." -Force | Out-Null
Write-Output "Installed '$TaskName'. Ensure UPFIELD_UPLOAD_KEY is available to the task's run-as account."

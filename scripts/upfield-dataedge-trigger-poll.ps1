<#
.SYNOPSIS
  Lets the dashboard's Trigger DataEdge button start an existing local
  DataEdge uploader task on its otherwise inbound-isolated source machine.

.DESCRIPTION
  Install this as a small two-minute Scheduled Task on the DataEdge machine.
  It polls the VPS with the same UPFIELD_UPLOAD_KEY bearer credential used by
  the uploader, claims one queued request, and starts the existing uploader
  task by name. The uploader's normal POST remains the authoritative data
  completion signal in Sync Health.
#>
param(
  [Parameter(Mandatory = $true)][string]$DataEdgeTaskName,
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$ApiKey = $env:UPFIELD_UPLOAD_KEY
)

$ErrorActionPreference = "Stop"
function Write-Log([string]$Message) { Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }
if (-not $ApiKey) { throw "Set UPFIELD_UPLOAD_KEY for the account that runs this poll task." }
$headers = @{ Authorization = "Bearer $ApiKey" }

try {
  $pending = Invoke-RestMethod -Uri "$AppUrl/api/upfield-timestamps/trigger/pending" -Headers $headers
} catch {
  Write-Log "Could not reach the trigger queue: $($_.Exception.Message)"
  exit 0
}
if (-not $pending.pending) { Write-Log "No pending DataEdge trigger."; exit 0 }

$success = $false
$summary = ""
try {
  Start-ScheduledTask -TaskName $DataEdgeTaskName
  $success = $true
  $summary = "Started local task '$DataEdgeTaskName'."
  Write-Log $summary
} catch {
  $summary = $_.Exception.Message
  Write-Log "Could not start local DataEdge task: $summary"
}

try {
  Invoke-RestMethod -Uri "$AppUrl/api/upfield-timestamps/trigger/complete" -Method Post -ContentType "application/json" -Headers $headers -Body (@{ id = $pending.id; success = $success; summary = $summary } | ConvertTo-Json -Compress) | Out-Null
} catch {
  Write-Log "Could not report trigger dispatch: $($_.Exception.Message)"
}
if (-not $success) { exit 1 }

param([Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference = 'Stop'
$taskNames = @('SalesDashboard-SalesReturnsSync-Smart', 'SalesDashboard-TriggerPoll')
$tasks = foreach ($taskName in $taskNames) {
  try {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
    [pscustomobject]@{
      name = $taskName; state = [string]$task.State
      lastRunTime = if ($info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('o') } else { $null }
      lastTaskResult = $info.LastTaskResult
      nextRunTime = if ($info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToString('o') } else { $null }
    }
  } catch { [pscustomobject]@{ name = $taskName; state = 'Missing'; lastRunTime = $null; lastTaskResult = $null; nextRunTime = $null; error = $_.Exception.Message } }
}
$projectExists = Test-Path -LiteralPath $ProjectPath
$syncScriptExists = $false
if ($projectExists) {
  $syncScriptExists = Test-Path -LiteralPath (Join-Path $ProjectPath 'scripts\sales-returns-sync.ps1')
}
[pscustomobject]@{
  projectExists = $projectExists
  syncScriptExists = $syncScriptExists
  tasks = @($tasks)
  checkedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 4

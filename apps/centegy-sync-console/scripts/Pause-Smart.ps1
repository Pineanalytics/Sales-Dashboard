param([Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference = 'Stop'
Disable-ScheduledTask -TaskName 'SalesDashboard-SalesReturnsSync-Smart' | Out-Null
Write-Output 'Smart sync schedule disabled.'

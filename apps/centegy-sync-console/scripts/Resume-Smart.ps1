param([Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference = 'Stop'
Enable-ScheduledTask -TaskName 'SalesDashboard-SalesReturnsSync-Smart' | Out-Null
Start-ScheduledTask -TaskName 'SalesDashboard-SalesReturnsSync-Smart'
Write-Output 'Smart sync schedule enabled and a run was requested.'

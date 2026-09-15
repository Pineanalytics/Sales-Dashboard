param([Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference = 'Stop'
Start-ScheduledTask -TaskName 'SalesDashboard-SalesReturnsSync-Smart'
Write-Output 'Smart sync start requested.'

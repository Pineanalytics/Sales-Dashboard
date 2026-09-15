param([Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference = 'Stop'
Stop-ScheduledTask -TaskName 'SalesDashboard-SalesReturnsSync-Smart'
Write-Output 'Running Smart sync stopped. The next enabled schedule remains unchanged.'

param([Parameter(Mandatory)][ValidateSet('NAIROBI','NYERI')][string]$Branch,[Parameter(Mandatory)][string]$PullerPath)
$task=if($Branch -eq 'NAIROBI'){'UKL-SalesExport-Pull'}else{'UKL-SalesExport-Pull-Nyeri'}
Stop-ScheduledTask -TaskName $task
Write-Output "$Branch running export stopped. Future schedules remain enabled."

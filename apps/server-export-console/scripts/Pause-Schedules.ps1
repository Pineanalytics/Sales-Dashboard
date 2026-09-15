param([Parameter(Mandatory)][string]$PullerPath)
$names=@('UKL-SalesExport-Pull','UKL-SalesExport-Pull-Nyeri','UKL-SalesExport-Pull-Nairobi-Boost','UKL-SalesExport-Pull-Nyeri-Boost')
foreach($name in $names){Disable-ScheduledTask -TaskName $name -ErrorAction Stop|Out-Null}
Write-Output 'All UKL Nairobi and Nyeri scheduled exports are disabled.'

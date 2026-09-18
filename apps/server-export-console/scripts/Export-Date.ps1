param([Parameter(Mandatory)][ValidateSet('NAIROBI','NYERI')][string]$Branch,[Parameter(Mandatory)][ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$Date,[Parameter(Mandatory)][string]$PullerPath)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $PullerPath)){throw "UKL puller not found: $PullerPath"}
$params=@{Branch=$Branch;Date=$Date}
& $PullerPath @params
exit $LASTEXITCODE

param(
  [Parameter(Mandatory)][string]$ProjectPath,
  [Parameter(Mandatory)][ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$Date
)
$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $ProjectPath 'scripts\sales-returns-sync.ps1'
if (-not (Test-Path -LiteralPath $wrapper)) { throw "Sync wrapper not found: $wrapper" }
$params = @{ ProjectPath = $ProjectPath; BackfillDate = $Date }
& $wrapper @params
exit $LASTEXITCODE

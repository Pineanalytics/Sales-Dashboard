<#
.SYNOPSIS
  Runs the dedicated EABL Call Performance SQL Server bridge on a 15-minute
  schedule. This source is separate from the Pine timestamps worker.
#>

param(
  [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard"
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }

Set-Location -Path $ProjectPath
try {
  Write-Log "Starting EABL Call Performance sync..."
  & node --import tsx "scripts\db-bridge\eabl-call-performance\run.ts"
  if ($LASTEXITCODE -ne 0) { throw "eabl-call-performance/run.ts exited with code $LASTEXITCODE" }
  Write-Log "EABL Call Performance sync finished."
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  throw
}

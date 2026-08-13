<#
.SYNOPSIS
  Scheduled wrapper for the direct SAP stock bridge. It opens the same short-lived
  VPS Postgres tunnel as sales-sync.ps1 for Product/Warehouse/Principal reference
  reads, then runs scripts/db-bridge/stock-sync.ts. Excel stock stays live until
  Admin confirms the recorded reconciliation.
#>
param(
  [string]$ProjectPath = "D:\sales-dashboard",
  # The existing bridge credentials remain in the established scheduled-sync
  # configuration. Read only the needed values into this process so the current
  # checked-in code can run without duplicating secrets into another .env file.
  [string]$SourceEnvPath = "D:\Reports & Extractions\Sales Dashboard\.env",
  [string]$SshKey = "$HOME/.ssh/pinefrost_hostinger",
  [string]$SshTarget = "root@187.77.80.216",
  [int]$LocalPgPort = 5434
)

$ErrorActionPreference = "Stop"
function Write-Log { param([string]$Message) Write-Output ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message) }
Set-Location -Path $ProjectPath

$tunnelJob = $null
try {
  Write-Log "Starting direct SAP stock sync..."
  if (-not (Test-Path -LiteralPath $SourceEnvPath)) { throw "Bridge configuration not found: $SourceEnvPath" }
  foreach ($line in Get-Content -LiteralPath $SourceEnvPath) {
    if ($line -match '^(SQLBRIDGE_SQL_[A-Z_]+|UPLOAD_API_KEY|PL_BRIDGE_APP_URL)=(.*)$') {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim('"')
    }
  }
  $pgIp = (& ssh -i $SshKey $SshTarget "docker inspect pinefrost-postgres-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'").Trim()
  if (-not $pgIp) { throw "Could not determine the VPS Postgres container IP." }
  $creds = @{}
  foreach ($line in (& ssh -i $SshKey $SshTarget "grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' /opt/pinefrost/.env")) {
    $parts = $line -split '=', 2
    if ($parts.Length -eq 2) { $creds[$parts[0]] = $parts[1].Trim('"') }
  }
  foreach ($key in @("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")) { if (-not $creds.ContainsKey($key)) { throw "Could not read $key from VPS .env." } }

  $tunnelJob = Start-Job -ScriptBlock { param($Key, $Target, $Port, $PgIp); & ssh -i $Key -N -o StrictHostKeyChecking=accept-new -L "${Port}:${PgIp}:5432" $Target } -ArgumentList $SshKey, $SshTarget, $LocalPgPort, $pgIp
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 500; if ((Test-NetConnection -ComputerName localhost -Port $LocalPgPort -WarningAction SilentlyContinue).TcpTestSucceeded) { $ready = $true; break } }
  if (-not $ready) { throw "Postgres tunnel on localhost:$LocalPgPort never came up." }

  $env:DATABASE_URL = "postgresql://$($creds['POSTGRES_USER']):$($creds['POSTGRES_PASSWORD'])@localhost:${LocalPgPort}/$($creds['POSTGRES_DB'])"
  $env:DIRECT_URL = $env:DATABASE_URL
  & node --import tsx "scripts\db-bridge\stock-sync.ts"
  if ($LASTEXITCODE -ne 0) { throw "stock-sync.ts exited with code $LASTEXITCODE" }
  Write-Log "Direct SAP stock sync finished."
}
catch { Write-Log "FAILED: $($_.Exception.Message)"; throw }
finally {
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\DIRECT_URL -ErrorAction SilentlyContinue
  Get-ChildItem Env: | Where-Object { $_.Name -match '^(SQLBRIDGE_SQL_|UPLOAD_API_KEY|PL_BRIDGE_APP_URL$)' } | Remove-Item -ErrorAction SilentlyContinue
  if ($tunnelJob) { Stop-Job $tunnelJob -ErrorAction SilentlyContinue; Remove-Job $tunnelJob -Force -ErrorAction SilentlyContinue }
}

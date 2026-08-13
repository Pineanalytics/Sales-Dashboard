<#
.SYNOPSIS
  Opens a short-lived, authenticated tunnel to the dashboard's production
  Postgres database for local scheduled bridges that need admin reference data.

.DESCRIPTION
  SAP/Pine source queries remain read-only and run locally. This helper only
  supplies Prisma with a temporary route to the production reference tables
  (Principals, Products, Warehouses, etc.). It never writes through the tunnel.
  SSH connection and keepalive limits prevent one unavailable VPS command from
  blocking a scheduled task indefinitely.
#>

function Open-ProductionReferenceTunnel {
  param(
    [string]$SshKey = "$env:USERPROFILE\.ssh\pinefrost_hostinger",
    [string]$SshTarget = "root@187.77.80.216",
    [int]$LocalPgPort = 5434
  )

  $sshOptions = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2")
  $pgIp = (& ssh @sshOptions $SshTarget "docker inspect pinefrost-postgres-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'").Trim()
  if (-not $pgIp) { throw "Could not determine the VPS Postgres container IP." }

  $credentials = @{}
  foreach ($line in (& ssh @sshOptions $SshTarget "grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' /opt/pinefrost/.env")) {
    $parts = $line -split '=', 2
    if ($parts.Length -eq 2) { $credentials[$parts[0]] = $parts[1].Trim('"') }
  }
  foreach ($key in @("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")) {
    if (-not $credentials.ContainsKey($key)) { throw "Could not read $key from the VPS configuration." }
  }

  $tunnelJob = Start-Job -ScriptBlock {
    param($keyPath, $target, $port, $containerIp)
    & ssh -i $keyPath -N -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -L "${port}:${containerIp}:5432" $target
  } -ArgumentList $SshKey, $SshTarget, $LocalPgPort, $pgIp

  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ((Test-NetConnection -ComputerName localhost -Port $LocalPgPort -WarningAction SilentlyContinue).TcpTestSucceeded) { $ready = $true; break }
  }
  if (-not $ready) {
    Stop-Job $tunnelJob -ErrorAction SilentlyContinue
    Remove-Job $tunnelJob -Force -ErrorAction SilentlyContinue
    throw "Production Postgres tunnel on localhost:$LocalPgPort did not become available."
  }

  return [PSCustomObject]@{
    Job = $tunnelJob
    DatabaseUrl = "postgresql://$($credentials['POSTGRES_USER']):$($credentials['POSTGRES_PASSWORD'])@localhost:${LocalPgPort}/$($credentials['POSTGRES_DB'])"
  }
}

function Close-ProductionReferenceTunnel {
  param($Tunnel)
  if ($Tunnel -and $Tunnel.Job) {
    Stop-Job $Tunnel.Job -ErrorAction SilentlyContinue
    Remove-Job $Tunnel.Job -Force -ErrorAction SilentlyContinue
  }
}

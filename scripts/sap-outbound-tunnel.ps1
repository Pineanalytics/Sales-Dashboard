<#
.SYNOPSIS
  Maintains the private office-to-VPS SAP tunnel for the server-side worker.

.DESCRIPTION
  This is a connectivity supervisor, not a data-sync scheduler. It makes a
  loopback-only port on the VPS available to the SAP worker and immediately
  reconnects if the office network or SSH session drops. SAP is never exposed
  on a public VPS interface.
#>
param(
  [string]$SshKey = "$env:USERPROFILE\.ssh\pinefrost_hostinger",
  [string]$SshTarget = "root@187.77.80.216",
  [int]$RemotePort = 14333,
  [string]$SapHost = "PINEFROSTSERVER",
  [int]$SapPort = 1433
)

$ErrorActionPreference = "Stop"
$logPath = Join-Path $PSScriptRoot "..\logs\sap-outbound-tunnel.log"

function Write-Log {
  param([string]$Message)
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
  Add-Content -LiteralPath $logPath -Value $line
}

while ($true) {
  try {
    Write-Log "Opening private SAP tunnel on VPS loopback port $RemotePort."
    & "$env:WINDIR\System32\OpenSSH\ssh.exe" -i $SshKey -N `
      -o BatchMode=yes `
      -o ExitOnForwardFailure=yes `
      -o ConnectTimeout=15 `
      -o ServerAliveInterval=15 `
      -o ServerAliveCountMax=2 `
      -R "127.0.0.1:${RemotePort}:${SapHost}:${SapPort}" `
      $SshTarget
    $exitCode = $LASTEXITCODE
    Write-Log "SAP tunnel exited with code $exitCode; retrying in 10 seconds."
  } catch {
    Write-Log "SAP tunnel error: $($_.Exception.Message); retrying in 10 seconds."
  }
  Start-Sleep -Seconds 10
}

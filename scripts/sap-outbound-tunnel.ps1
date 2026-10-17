<#
.SYNOPSIS
  Maintains the private office-to-VPS SAP tunnel for the server-side worker, and restarts it when it hangs.

.DESCRIPTION
  This is a connectivity supervisor, not a data-sync scheduler. It makes a
  loopback-only port on the VPS available to the SAP worker and immediately
  reconnects if the office network or SSH session drops. SAP is never exposed
  on a public VPS interface.

  Watchdog (added after the 15-17 October 2026 outage): the ssh client can wedge
  on Windows - the process stays alive with local ports bound but no connection
  to the VPS, so the old "run ssh, wait for it to exit" loop waited forever and
  every SAP-fed job on the VPS failed with "Could not connect to 127.0.0.1:14333".
  ssh now runs as a monitored child process. Every $CheckSeconds the watchdog
  checks that it still holds an ESTABLISHED connection to the VPS, and every
  $ProbeEverySeconds it asks the VPS whether the tunnel port is really listening.
  A process that exited, one with no connection for $ConnectGraceSeconds, or a port
  the VPS cannot see for $ProbeFailuresToRestart checks in a row is killed and
  started again, with a growing pause while the network is down.

  State is written to logs\sap-outbound-tunnel.status.json (connected /
  connecting / restarting, since when, the last restart reason, restarts in the
  last 24 hours) so a status check can read it. One supervisor runs at a time
  (a named mutex), so starting it by hand while the scheduled task is running is safe.

.PARAMETER SelfTest
  Checks the decision logic and exits (no SSH): powershell -File sap-outbound-tunnel.ps1 -SelfTest

.NOTES
  Windows PowerShell 5.1, OpenSSH for Windows. Keep this file ASCII only.
#>
param(
  [string]$SshKey = "$env:USERPROFILE\.ssh\pinefrost_hostinger",
  [string]$SshTarget = "root@187.77.80.216",
  [int]$RemotePort = 14333,
  [string]$SapHost = "PINEFROSTSERVER",
  [int]$SapPort = 1433,
  [int]$CheckSeconds = 15,
  [int]$ConnectGraceSeconds = 60,
  [int]$ProbeEverySeconds = 120,
  [int]$ProbeFailuresToRestart = 3,
  [int]$ProbeTimeoutSeconds = 25,
  [string]$LogPath = "",
  [string]$StatusPath = "",
  [string]$MutexName = "Global\Pinefrost-SapOutboundTunnel",
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
if (-not $LogPath) { $LogPath = Join-Path $PSScriptRoot "..\logs\sap-outbound-tunnel.log" }
if (-not $StatusPath) { $StatusPath = Join-Path $PSScriptRoot "..\logs\sap-outbound-tunnel.status.json" }
$sshExe = Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe"

# ---------------------------------------------------------------------------
# Decision logic (pure, so -SelfTest can check it without a network)
# ---------------------------------------------------------------------------

# What the watchdog should do about the running ssh: "ok", "exited", "hung" or "port-down".
function Get-TunnelVerdict {
  param(
    [bool]$Exited,
    [double]$SecondsWithoutConnection,
    [int]$ConnectGrace,
    [int]$ProbeFailures,
    [int]$ProbeFailuresToRestart
  )
  if ($Exited) { return "exited" }
  if ($SecondsWithoutConnection -gt $ConnectGrace) { return "hung" }
  if ($ProbeFailures -ge $ProbeFailuresToRestart) { return "port-down" }
  return "ok"
}

# Seconds to wait before starting ssh again: 10 to begin with, doubling up to 60 while it keeps failing quickly, back to 10 once a run was stable.
function Get-RestartDelay {
  param([int]$PreviousDelay, [double]$LastRunSeconds)
  if ($LastRunSeconds -ge 300) { return 10 }
  return [Math]::Min([Math]::Max($PreviousDelay * 2, 10), 60)
}

if ($SelfTest) {
  $failed = 0
  function Assert-Equal($Actual, $Expected, $Name) {
    if ($Actual -ne $Expected) { Write-Host "FAIL $Name : expected '$Expected' got '$Actual'"; $script:failed++ } else { Write-Host "ok   $Name" }
  }
  Assert-Equal (Get-TunnelVerdict -Exited $true -SecondsWithoutConnection 0 -ConnectGrace 60 -ProbeFailures 0 -ProbeFailuresToRestart 3) "exited" "an exited ssh is restarted"
  Assert-Equal (Get-TunnelVerdict -Exited $false -SecondsWithoutConnection 30 -ConnectGrace 60 -ProbeFailures 0 -ProbeFailuresToRestart 3) "ok" "a new ssh gets its grace period"
  Assert-Equal (Get-TunnelVerdict -Exited $false -SecondsWithoutConnection 61 -ConnectGrace 60 -ProbeFailures 0 -ProbeFailuresToRestart 3) "hung" "no connection past the grace period is a hang (the 15 October failure)"
  Assert-Equal (Get-TunnelVerdict -Exited $false -SecondsWithoutConnection 0 -ConnectGrace 60 -ProbeFailures 2 -ProbeFailuresToRestart 3) "ok" "two failed probes are tolerated"
  Assert-Equal (Get-TunnelVerdict -Exited $false -SecondsWithoutConnection 0 -ConnectGrace 60 -ProbeFailures 3 -ProbeFailuresToRestart 3) "port-down" "three failed probes restart it"
  Assert-Equal (Get-TunnelVerdict -Exited $true -SecondsWithoutConnection 999 -ConnectGrace 60 -ProbeFailures 9 -ProbeFailuresToRestart 3) "exited" "exited wins over the other signals"
  Assert-Equal (Get-RestartDelay -PreviousDelay 10 -LastRunSeconds 20) 20 "the pause doubles after a short run"
  Assert-Equal (Get-RestartDelay -PreviousDelay 40 -LastRunSeconds 20) 60 "the pause is capped at 60 seconds"
  Assert-Equal (Get-RestartDelay -PreviousDelay 60 -LastRunSeconds 900) 10 "a stable run resets the pause"
  Assert-Equal (Get-RestartDelay -PreviousDelay 0 -LastRunSeconds 5) 10 "the first pause is 10 seconds"
  if ($failed -gt 0) { Write-Host "$failed self-test(s) failed."; exit 1 }
  Write-Host "All self-tests passed."
  exit 0
}

# ---------------------------------------------------------------------------
# Logging and status
# ---------------------------------------------------------------------------

$logDirectory = Split-Path -Parent $LogPath
if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }

function Write-Log {
  param([string]$Message)
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
  try {
    # Keep the log small: one older copy at most.
    if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 2MB)) {
      Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force
    }
    Add-Content -LiteralPath $LogPath -Value $line
  } catch { }
}

$script:restartTimes = New-Object System.Collections.Generic.List[datetime]
$script:lastRestartReason = $null
$script:lastRestartAt = $null

function Write-Status {
  param([string]$State, [int]$SshPid = 0, $ConnectedSince = $null)
  try {
    $cutoff = (Get-Date).AddHours(-24)
    $recent = @($script:restartTimes | Where-Object { $_ -gt $cutoff })
    $status = [ordered]@{
      updatedAt         = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
      state             = $State
      sshPid            = $SshPid
      connectedSince    = $(if ($ConnectedSince) { ([datetime]$ConnectedSince).ToString("yyyy-MM-dd HH:mm:ss") } else { $null })
      remotePort        = $RemotePort
      lastRestartAt     = $(if ($script:lastRestartAt) { $script:lastRestartAt.ToString("yyyy-MM-dd HH:mm:ss") } else { $null })
      lastRestartReason = $script:lastRestartReason
      restartsLast24h   = $recent.Count
      supervisorPid     = $PID
    }
    $temp = "$StatusPath.tmp"
    ($status | ConvertTo-Json) | Set-Content -LiteralPath $temp -Encoding ASCII
    Move-Item -LiteralPath $temp -Destination $StatusPath -Force
  } catch { }
}

# ---------------------------------------------------------------------------
# Helpers that touch the machine
# ---------------------------------------------------------------------------

function Start-Ssh {
  param([string]$Arguments)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $sshExe
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  return [System.Diagnostics.Process]::Start($info)
}

# True while the ssh process holds an ESTABLISHED connection to the VPS's ssh port.
function Test-SshConnected {
  param([int]$ProcessId)
  try {
    $found = @(Get-NetTCPConnection -OwningProcess $ProcessId -State Established -ErrorAction Stop | Where-Object { $_.RemotePort -eq 22 })
    return ($found.Count -gt 0)
  } catch { return $false }
}

# Asks the VPS (over a second, short-lived ssh) whether the tunnel's loopback port is listening. A probe that cannot even connect counts as a failure.
function Test-RemotePortListening {
  $remoteCommand = "ss -ltn | grep -q '127.0.0.1:${RemotePort} '"
  $arguments = "-i `"$SshKey`" -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 $SshTarget `"$remoteCommand`""
  $probe = $null
  try {
    $probe = Start-Ssh -Arguments $arguments
    if (-not $probe.WaitForExit($ProbeTimeoutSeconds * 1000)) {
      try { $probe.Kill() } catch { }
      return $false
    }
    return ($probe.ExitCode -eq 0)
  } catch { return $false }
}

# An ssh left over from a supervisor that died holds the same forward; end it so the new one can take the port.
function Stop-OrphanTunnelProcesses {
  try {
    $pattern = [regex]::Escape("-R 127.0.0.1:${RemotePort}:")
    Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -match $pattern } | ForEach-Object {
      Write-Log "Ending leftover tunnel ssh (pid $($_.ProcessId)) from an earlier supervisor."
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch { Write-Log "Could not look for leftover tunnel processes: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------------------
# Supervisor
# ---------------------------------------------------------------------------

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)
if (-not $createdNew) {
  Write-Log "Another SAP tunnel supervisor is already running; this one exits."
  exit 0
}

$tunnelArguments = "-i `"$SshKey`" -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 -R 127.0.0.1:${RemotePort}:${SapHost}:${SapPort} $SshTarget"
$restartDelay = 5 # so the first pause is 10 seconds, then 20, 40, 60

try {
  Write-Log "SAP tunnel supervisor started (pid $PID); watchdog checks every $CheckSeconds s, probe every $ProbeEverySeconds s."
  Stop-OrphanTunnelProcesses

  while ($true) {
    $startedAt = Get-Date
    $reason = $null
    $ssh = $null
    try {
      Write-Log "Opening private SAP tunnel on VPS loopback port $RemotePort."
      Write-Status -State "connecting"
      $ssh = Start-Ssh -Arguments $tunnelArguments
      $lastConnected = $startedAt
      $connectedSince = $null
      $nextProbe = $startedAt.AddSeconds($ProbeEverySeconds)
      $probeFailures = 0

      while ($true) {
        Start-Sleep -Seconds $CheckSeconds
        $now = Get-Date
        $exited = $ssh.HasExited
        $connected = $false
        if (-not $exited) { $connected = Test-SshConnected -ProcessId $ssh.Id }
        if ($connected) {
          $lastConnected = $now
          if (-not $connectedSince) {
            $connectedSince = $now
            Write-Log "SAP tunnel connected (ssh pid $($ssh.Id))."
          }
        } elseif ($connectedSince) {
          $connectedSince = $null
        }
        # End-to-end check: does the VPS see the port? Only asked while ssh looks connected.
        if ($connected -and $now -ge $nextProbe) {
          $nextProbe = $now.AddSeconds($ProbeEverySeconds)
          if (Test-RemotePortListening) { $probeFailures = 0 } else { $probeFailures++; Write-Log "The VPS does not see port $RemotePort (check $probeFailures of $ProbeFailuresToRestart)." }
        }
        $verdict = Get-TunnelVerdict -Exited $exited -SecondsWithoutConnection (($now - $lastConnected).TotalSeconds) -ConnectGrace $ConnectGraceSeconds -ProbeFailures $probeFailures -ProbeFailuresToRestart $ProbeFailuresToRestart
        if ($verdict -eq "ok") {
          Write-Status -State $(if ($connected) { "connected" } else { "connecting" }) -SshPid $ssh.Id -ConnectedSince $connectedSince
          continue
        }
        switch ($verdict) {
          "exited"    { $reason = "ssh exited with code $($ssh.ExitCode)" }
          "hung"      { $reason = "ssh had no connection to the VPS for $([int](($now - $lastConnected).TotalSeconds)) seconds (hung)" }
          "port-down" { $reason = "the VPS could not see port $RemotePort for $probeFailures checks in a row" }
        }
        break
      }
    } catch {
      $reason = "supervisor error: $($_.Exception.Message)"
    } finally {
      if ($ssh -and -not $ssh.HasExited) {
        try { $ssh.Kill(); $ssh.WaitForExit(5000) | Out-Null } catch { }
      }
    }

    $script:lastRestartAt = Get-Date
    $script:lastRestartReason = $reason
    $script:restartTimes.Add($script:lastRestartAt)
    $runSeconds = ($script:lastRestartAt - $startedAt).TotalSeconds
    $restartDelay = Get-RestartDelay -PreviousDelay $restartDelay -LastRunSeconds $runSeconds
    Write-Log "SAP tunnel restarting: $reason; retrying in $restartDelay seconds."
    Write-Status -State "restarting"
    Start-Sleep -Seconds $restartDelay
  }
} finally {
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}

<#
.SYNOPSIS
  Shared, machine-wide lock for every Sales & Returns bridge entry point.

.DESCRIPTION
  The five-minute scheduled sync and a manually queued trigger can both run
  on the same isolated Centegy PC. They must never invoke run.ts together:
  every upload is a delete-and-replace transaction for the same branch/date.
  A Global mutex also protects tasks launched under different Windows users.
#>

function Enter-SalesReturnsSyncLock {
  param([Parameter(Mandatory = $true)][string]$Distributor)

  if ($Distributor -notmatch '^\d+$') {
    throw 'Sales & Returns distributor must be numeric before acquiring the sync lock.'
  }

  $mutex = [System.Threading.Mutex]::new($false, "Global\Pinefrost-SalesReturnsSync-$Distributor")
  $held = $false
  try {
    try {
      $held = $mutex.WaitOne(0, $false)
    }
    catch [System.Threading.AbandonedMutexException] {
      # The prior process exited unexpectedly. Windows has released its lock,
      # so this process safely becomes the owner and can continue.
      $held = $true
    }
    return [pscustomobject]@{ Mutex = $mutex; Held = $held }
  }
  catch {
    $mutex.Dispose()
    throw
  }
}

function Exit-SalesReturnsSyncLock {
  param([Parameter(Mandatory = $true)]$Lock)

  try {
    if ($Lock.Held) { $Lock.Mutex.ReleaseMutex() }
  }
  finally {
    $Lock.Mutex.Dispose()
  }
}

<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the live JP Adherence sync
    (scripts/db-bridge/jp-adherence/run.ts), which pulls a trailing 90-day
    window of fact lines straight from the "pine" field-force MySQL DB
    (159.65.222.131 — same server as the Active Outlets/Coverage bridges) and
    pushes Journey Plan / JP Adherence / Monthly Split to the live dashboard's
    JourneyPlanRow/JPAdherenceDaily/JPAdherenceDetail/JPMonthlySplitRow tables
    via three upload routes.

.DESCRIPTION
    Same pattern as active-outlets-sync.ps1/pl-sync.ps1: runs `node --import
    tsx` directly rather than `npm run jp-adherence:sync` - npm/npx fail to
    resolve the project's node_modules when invoked non-interactively from a
    path containing "&" (this project's own folder name), a known quirk on
    this machine. Every non-fatal notice in run.ts uses console.log, not
    console.warn - stderr output from a native command can get misread as a
    fatal error by this wrapper's $ErrorActionPreference = "Stop" in a
    non-interactive Task Scheduler session (the false-failure bug hit and
    fixed on pl-sync.ps1 earlier this session). Given its own time slot
    (08:00/19:00) after the other three jobs (06:00/17:00, 06:30/17:30,
    07:00/18:00, 07:30/18:30) for predictable logs.
#>

param(
    [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard"
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Output $line
}

Set-Location -Path $ProjectPath

try {
    Write-Log "Starting JP Adherence sync..."
    & node --import tsx "scripts\db-bridge\jp-adherence\run.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "jp-adherence/run.ts exited with code $LASTEXITCODE"
    }
    Write-Log "JP Adherence sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

<#
.SYNOPSIS
    Wrapper for Task Scheduler: triggers the daily AI Insights digest
    (scripts/ai-insights/trigger.ts), which POSTs to /api/ai-insights/generate.
    No local DB connection needed — the underlying data is already synced to
    Postgres by the other scheduled jobs; this just asks Claude to summarize it.

.DESCRIPTION
    Same pattern as sales-sync.ps1/pl-sync.ps1: runs `node --import tsx`
    directly rather than `npm run ai-insights:sync` - npm/npx fail to resolve
    the project's node_modules when invoked non-interactively from a path
    containing "&" (this project's own folder name), a known quirk on this
    machine.
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
    Write-Log "Starting AI Insights sync..."
    & node --import tsx "scripts\ai-insights\trigger.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "ai-insights/trigger.ts exited with code $LASTEXITCODE"
    }
    Write-Log "AI Insights sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}

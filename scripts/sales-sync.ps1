<#
.SYNOPSIS
    Wrapper for Task Scheduler: runs the direct-SQL Sales sync
    (scripts/db-bridge/sales-sync.ts), which pulls Revenue/COGS/Gross Profit
    straight from PINEFROSTSERVER (SAP) and pushes it to the live dashboard's
    SalesRecord table via /api/sales/upload.

.DESCRIPTION
    Unlike export-and-upload.ps1, this never touches Excel/COM - it's a plain
    Node/tsx script hitting SQL Server directly. Runs `node --import tsx`
    directly rather than `npm run sales:sync` - npm/npx fail to resolve the
    project's node_modules when invoked non-interactively from a path
    containing "&" (this project's own folder name), a known quirk on this
    machine. Scheduled offset from the Excel job (06:00/17:00) so the two
    don't hit PINEFROSTSERVER at the same moment.

    sales-sync.ts also reads Product/Warehouse reference data from Postgres
    via Prisma (scripts/db-bridge/reference/loadFromDb.ts) - since the
    Netlify/Supabase retirement, the local repo's own .env has no valid
    DATABASE_URL (Supabase is gone, and Postgres now lives on the VPS,
    deliberately not exposed outside its Docker network - see
    docker-compose.yml). This script opens a short-lived SSH tunnel to the
    VPS's postgres container for the duration of one sync run and points
    DATABASE_URL/DIRECT_URL at it, reading the real credentials from the
    VPS's own .env at run time (same pattern deploy.ps1 uses for
    -PushSchema) rather than storing them here. Tunnel is always torn down
    in the finally block, success or failure.
#>

param(
    [string]$ProjectPath = "D:\Reports & Extractions\Sales Dashboard",
    [string]$SshKey = "$HOME/.ssh/pinefrost_hostinger",
    [string]$SshTarget = "root@187.77.80.216",
    [int]$LocalPgPort = 5433
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Output $line
}

Set-Location -Path $ProjectPath

$tunnelJob = $null
try {
    Write-Log "Starting Sales sync..."

    Write-Log "Opening tunnel to VPS Postgres for reference-data reads..."
    $pgIp = (& ssh -i $SshKey $SshTarget "docker inspect pinefrost-postgres-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'").Trim()
    if (-not $pgIp) { throw "Could not determine the VPS Postgres container's network IP." }

    $envLines = & ssh -i $SshKey $SshTarget "grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' /opt/pinefrost/.env"
    $creds = @{}
    foreach ($line in $envLines) {
        $parts = $line -split '=', 2
        if ($parts.Length -eq 2) { $creds[$parts[0]] = $parts[1].Trim('"') }
    }
    foreach ($key in @("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")) {
        if (-not $creds.ContainsKey($key)) { throw "Could not read $key from the VPS's .env." }
    }

    $tunnelJob = Start-Job -ScriptBlock {
        param($Key, $Target, $Port, $PgIp)
        & ssh -i $Key -N -o StrictHostKeyChecking=accept-new -L "${Port}:${PgIp}:5432" $Target
    } -ArgumentList $SshKey, $SshTarget, $LocalPgPort, $pgIp

    $tunnelReady = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $probe = Test-NetConnection -ComputerName "localhost" -Port $LocalPgPort -WarningAction SilentlyContinue
        if ($probe.TcpTestSucceeded) { $tunnelReady = $true; break }
    }
    if (-not $tunnelReady) { throw "Postgres tunnel on localhost:$LocalPgPort never came up." }

    $env:DATABASE_URL = "postgresql://$($creds['POSTGRES_USER']):$($creds['POSTGRES_PASSWORD'])@localhost:${LocalPgPort}/$($creds['POSTGRES_DB'])"
    $env:DIRECT_URL = $env:DATABASE_URL

    & node --import tsx "scripts\db-bridge\sales-sync.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "sales-sync.ts exited with code $LASTEXITCODE"
    }
    Write-Log "Sales sync finished."
}
catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    throw
}
finally {
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\DIRECT_URL -ErrorAction SilentlyContinue
    if ($tunnelJob) {
        Stop-Job $tunnelJob -ErrorAction SilentlyContinue
        Remove-Job $tunnelJob -Force -ErrorAction SilentlyContinue
    }
}

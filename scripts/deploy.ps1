<#
.SYNOPSIS
    Deploys the current committed tree to the self-hosted Hostinger VPS.

.DESCRIPTION
    Replaces the ad-hoc "SSH in and figure it out" process with one documented
    command. Packages exactly what's committed (git archive - no node_modules,
    .next, .git, or local .env), copies it over the VPS's /opt/pinefrost without
    touching that machine's own .env, rebuilds the Docker images, and restarts
    the app container.

    With -PushSchema, also runs `prisma db push` against the VPS's real Postgres
    (inside a throwaway pinefrost-builder container on the Compose network) -
    use this whenever prisma/schema.prisma has changed. Without it, this only
    ships code.

    Postgres itself is never exposed outside the VPS (see docker-compose.yml) -
    this is the only sanctioned way to run a schema push or one-off data script
    against the real production database. Don't repoint a local .env at it;
    there's nothing to repoint it at from outside the VPS's own Docker network.

    With -BackfillLiveDataset, runs the legacy-snapshot backfill inside that
    same private network before restarting the app. This is the required
    cutover order for retiring Snapshot as the dashboard's runtime source.

.PARAMETER PushSchema
    Also run `prisma db push` against the VPS's production Postgres after the
    app container is back up.

.PARAMETER BackfillLiveDataset
    Before restarting the new app image, dry-run then apply the one-time
    missing-row-only Snapshot-to-live-table backfill on production Postgres.

.PARAMETER SshKey
    Path to the SSH private key. Defaults to ~/.ssh/pinefrost_hostinger.

.PARAMETER SshTarget
    user@host for the VPS. Defaults to root@187.77.80.216.

.PARAMETER RemotePath
    Where the app lives on the VPS. Defaults to /opt/pinefrost.

.EXAMPLE
    ./scripts/deploy.ps1
    Ship today's code changes only.

.EXAMPLE
    ./scripts/deploy.ps1 -PushSchema
    Ship code and sync prisma/schema.prisma to production.

.EXAMPLE
    ./scripts/deploy.ps1 -BackfillLiveDataset
    Backfill legacy Snapshot facts, then switch the dashboard to the live
    server-to-server data path without a historical-data gap.
#>
param(
    [switch]$PushSchema,
    [switch]$BackfillLiveDataset,
    # Only needed when a schema change narrows or restructures an existing
    # constraint (e.g. widening a @@unique to add a column) - Prisma flags
    # this generically as "possible data loss" even when the change is
    # provably safe for existing rows (a widened unique key can never
    # conflict with data that already satisfied the narrower one). Opt-in
    # per invocation, never a default, so a genuinely destructive change
    # still stops for review.
    [switch]$AcceptDataLoss,
    [string]$SshKey = "$HOME/.ssh/pinefrost_hostinger",
    [string]$SshTarget = "root@187.77.80.216",
    [string]$RemotePath = "/opt/pinefrost"
)

$ErrorActionPreference = "Stop"

function Invoke-Ssh([string]$Command) {
    & ssh -i $SshKey $SshTarget $Command
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed (exit $LASTEXITCODE): $Command" }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $tarPath = Join-Path ([System.IO.Path]::GetTempPath()) "pinefrost-deploy-$(Get-Date -Format yyyyMMddHHmmss).tar"

    Write-Host "==> Packaging committed tree ($tarPath)..." -ForegroundColor Cyan
    & git archive --format=tar -o $tarPath HEAD
    if ($LASTEXITCODE -ne 0) { throw "git archive failed" }

    Write-Host "==> Backing up current deployment on the VPS..." -ForegroundColor Cyan
    $backupSuffix = Get-Date -Format yyyyMMdd-HHmmss
    Invoke-Ssh "cp -a $RemotePath ${RemotePath}-backup-$backupSuffix"

    Write-Host "==> Copying archive to the VPS..." -ForegroundColor Cyan
    & scp -i $SshKey $tarPath "${SshTarget}:/tmp/pinefrost-deploy.tar"
    if ($LASTEXITCODE -ne 0) { throw "scp failed" }
    Remove-Item $tarPath -Force

    # `tar -xf` only overlays files present in the new archive - it never removes a
    # file that existed on a previous deploy but has since been deleted from git, so
    # without this the VPS's tree silently accumulates stale files forever (a real
    # bug this project hit: a removed debug route kept serving requests through two
    # further deploys because its file just sat there, untouched by tar). Wiping
    # $RemotePath first (except .env, which isn't tracked and must survive) makes
    # every deploy an exact mirror of the committed tree, matching this script's own
    # documented intent.
    Write-Host "==> Clearing $RemotePath (except protected environment files) before extracting..." -ForegroundColor Cyan
    Invoke-Ssh "find $RemotePath -mindepth 1 -not -name '.env' -not -name '.sync.env' -delete"

    Write-Host "==> Extracting the committed tree into $RemotePath..." -ForegroundColor Cyan
    Invoke-Ssh "cd $RemotePath && tar -xf /tmp/pinefrost-deploy.tar && rm /tmp/pinefrost-deploy.tar"

    Write-Host "==> Rebuilding the app image..." -ForegroundColor Cyan
    Invoke-Ssh "cd $RemotePath && docker compose build app"

    if ($PushSchema -or $BackfillLiveDataset) {
        Write-Host "==> Rebuilding pinefrost-builder (full node_modules, needed for the requested production operation)..." -ForegroundColor Cyan
        Invoke-Ssh "cd $RemotePath && docker build --target builder -t pinefrost-builder:latest ."
    }

    if ($BackfillLiveDataset) {
        $backfillBase = 'source ' + $RemotePath + '/.env && docker run --rm --network pinefrost_default ' +
            '-e DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-e DIRECT_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-w /app pinefrost-builder:latest node --import tsx scripts/backfill-live-dataset.ts'
        Write-Host "==> Dry-running the legacy Snapshot backfill on production Postgres..." -ForegroundColor Cyan
        Invoke-Ssh $backfillBase
        Write-Host "==> Applying missing legacy Snapshot facts to production Postgres..." -ForegroundColor Cyan
        Invoke-Ssh ($backfillBase + ' --apply')
    }

    Write-Host "==> Restarting the app container..." -ForegroundColor Cyan
    Invoke-Ssh "cd $RemotePath && docker compose up -d app"

    if ($PushSchema) {
        Write-Host "==> Pushing prisma/schema.prisma to the VPS's production Postgres..." -ForegroundColor Cyan
        $pushArgs = if ($AcceptDataLoss) { ' db push --accept-data-loss' } else { ' db push' }
        $pushCmd = 'source ' + $RemotePath + '/.env && docker run --rm --network pinefrost_default ' +
            '-e DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-e DIRECT_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-w /app pinefrost-builder:latest node ./node_modules/prisma/build/index.js' + $pushArgs
        Invoke-Ssh $pushCmd
    }

    Write-Host "==> Verifying the site responds..." -ForegroundColor Cyan
    Start-Sleep -Seconds 3
    try {
        $health = Invoke-WebRequest -Uri "https://pinefrostdb.com/api/health" -TimeoutSec 10 -UseBasicParsing
        Write-Host "    /api/health -> HTTP $($health.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Warning "Could not reach https://pinefrostdb.com/api/health - check the container logs before assuming this deploy is good."
    }

    Write-Host "==> Done." -ForegroundColor Cyan
    Write-Host "    Backup of the previous deployment: ${RemotePath}-backup-$backupSuffix (remove it once you're confident this deploy is good)."
} finally {
    Pop-Location
}

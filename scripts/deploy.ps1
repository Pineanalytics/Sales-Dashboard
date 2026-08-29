<#
.SYNOPSIS
    Deploys the current committed tree to the self-hosted Hostinger VPS.

.DESCRIPTION
    Replaces the ad-hoc "SSH in and figure it out" process with one documented
    command. Packages exactly what's committed (git archive - no node_modules,
    .next, .git, or local .env), copies it over the VPS's /opt/pinefrost without
    touching that machine's own .env. It accepts only a clean master commit that
    exactly matches origin/master, serializes deployments with a VPS lock, and
    rebuilds the dashboard plus every code-bearing sync worker from one archive.

    With -PushSchema, first creates a pg_dump and then runs `prisma db push`
    against the VPS's real Postgres
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
    Back up production Postgres and apply an additive Prisma schema update
    before application containers restart.

.PARAMETER PreflightOnly
    Verify branch, cleanliness, and synchronization with origin/master without
    connecting to or changing production.

.PARAMETER AcceptDataLoss
    Disabled. Destructive production schema changes require a separately
    reviewed migration and rollback plan.

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
    Back up production, apply an additive Prisma schema update, and ship code.

.EXAMPLE
    ./scripts/deploy.ps1 -BackfillLiveDataset
    Backfill legacy Snapshot facts, then switch the dashboard to the live
    server-to-server data path without a historical-data gap.
#>
param(
    [switch]$PushSchema,
    [switch]$BackfillLiveDataset,
    [switch]$PreflightOnly,
    # Retained only to fail old invocations with an explicit safety message.
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

function Invoke-GitCapture([string[]]$Arguments) {
    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed" }
    return ($output | Out-String).Trim()
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
$deployLockAcquired = $false
$deployLockPath = "/var/lock/pinefrost-deploy.lock"
$restartCompleted = $false
try {
    if ($AcceptDataLoss) {
        throw "-AcceptDataLoss is disabled for production. Use a reviewed expand/contract schema change instead."
    }

    Write-Host "==> Running production deployment preflight..." -ForegroundColor Cyan
    $branch = Invoke-GitCapture @("branch", "--show-current")
    $isGitHubMaster = $env:GITHUB_ACTIONS -eq "true" -and $env:GITHUB_REF -eq "refs/heads/master"
    if ($branch -ne "master" -and -not $isGitHubMaster) {
        throw "Production deploys are allowed only from master (current branch: '$branch'). Merge the work into master first."
    }

    $workingTree = Invoke-GitCapture @("status", "--porcelain", "--untracked-files=all")
    if ($workingTree) {
        throw "The working tree is not clean. Commit or preserve every change before deploying:`n$workingTree"
    }

    & git fetch origin master
    if ($LASTEXITCODE -ne 0) { throw "Could not refresh origin/master; refusing an unverifiable production deploy." }
    $commitSha = Invoke-GitCapture @("rev-parse", "HEAD")
    $remoteMasterSha = Invoke-GitCapture @("rev-parse", "origin/master")
    if ($commitSha -ne $remoteMasterSha) {
        throw "HEAD ($commitSha) does not exactly match origin/master ($remoteMasterSha). Push/pull and reconcile before deploying."
    }

    $schemaFingerprint = (Get-FileHash -Algorithm SHA256 (Join-Path $repoRoot "prisma/schema.prisma")).Hash.ToLowerInvariant()
    $builtAt = (Get-Date).ToUniversalTime().ToString("o")
    $shortSha = $commitSha.Substring(0, 12)
    Write-Host "    master@$shortSha · schema $($schemaFingerprint.Substring(0, 12))" -ForegroundColor Green
    if ($PreflightOnly) {
        Write-Host "==> Preflight passed; no production changes requested." -ForegroundColor Green
        return
    }

    Write-Host "==> Acquiring the VPS deployment lock..." -ForegroundColor Cyan
    Invoke-Ssh "if mkdir '$deployLockPath' 2>/dev/null; then printf '%s\n' '$commitSha' > '$deployLockPath/owner'; else echo 'Another production deployment holds the lock:'; cat '$deployLockPath/owner' 2>/dev/null || true; exit 73; fi"
    $deployLockAcquired = $true

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
    Invoke-Ssh "find $RemotePath -mindepth 1 -not -name '.env' -not -name '.sync.env' -not -name '.deployment.json' -delete"

    Write-Host "==> Extracting the committed tree into $RemotePath..." -ForegroundColor Cyan
    Invoke-Ssh "cd $RemotePath && tar -xf /tmp/pinefrost-deploy.tar && rm /tmp/pinefrost-deploy.tar"

    $deploymentJson = @{ commit = $commitSha; branch = "master"; builtAt = $builtAt; schemaFingerprint = $schemaFingerprint } | ConvertTo-Json -Compress

    $services = "app live-sync-worker outlets-sync-worker mars-kpis-sync-worker sap-sync-worker"
    $images = @(
        "pinefrost-app",
        "pinefrost-live-sync-worker",
        "pinefrost-outlets-sync-worker",
        "pinefrost-mars-kpis-sync-worker",
        "pinefrost-sap-sync-worker"
    )
    $imageList = $images -join " "

    Write-Host "==> Preserving the currently running images as last-good..." -ForegroundColor Cyan
    Invoke-Ssh "for image in $imageList; do if docker image inspect `$image:latest >/dev/null 2>&1; then docker tag `$image:latest `$image:last-good; fi; done"

    Write-Host "==> Rebuilding the app and every code-bearing sync worker..." -ForegroundColor Cyan
    $buildArgs = "--build-arg APP_BUILD_COMMIT=$commitSha --build-arg APP_BUILD_BRANCH=master --build-arg APP_BUILT_AT='$builtAt' --build-arg APP_SCHEMA_FINGERPRINT=$schemaFingerprint"
    Invoke-Ssh "cd $RemotePath && docker compose build $buildArgs $services"

    Write-Host "==> Tagging immutable rollback images ($shortSha)..." -ForegroundColor Cyan
    Invoke-Ssh "for image in $imageList; do docker tag `$image:latest `$image:$commitSha; done"

    if ($PushSchema -or $BackfillLiveDataset) {
        Write-Host "==> Rebuilding pinefrost-builder (full node_modules, needed for the requested production operation)..." -ForegroundColor Cyan
        Invoke-Ssh "cd $RemotePath && docker build --target builder -t pinefrost-builder:latest ."
    }

    if ($PushSchema) {
        Write-Host "==> Backing up production Postgres before the schema operation..." -ForegroundColor Cyan
        $dbBackup = "/opt/pinefrost-db-backups/pinefrost-$shortSha-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
        Invoke-Ssh "cd $RemotePath && source .env && mkdir -p /opt/pinefrost-db-backups && docker compose exec -T postgres pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB -Fc > '$dbBackup'"

        Write-Host "==> Pushing the additive Prisma schema before restarting application containers..." -ForegroundColor Cyan
        $pushCmd = 'source ' + $RemotePath + '/.env && docker run --rm --network pinefrost_default ' +
            '-e DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-e DIRECT_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB ' +
            '-w /app pinefrost-builder:latest node ./node_modules/prisma/build/index.js db push'
        Invoke-Ssh $pushCmd
        Write-Host "    Database backup: $dbBackup" -ForegroundColor Green
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

    Write-Host "==> Restarting the app and every code-bearing sync worker..." -ForegroundColor Cyan
    Invoke-Ssh "cd $RemotePath && docker compose up -d --no-deps $services"
    $restartCompleted = $true

    Write-Host "==> Verifying the site responds..." -ForegroundColor Cyan
    try {
        $healthVerified = $false
        $lastHealthError = $null
        for ($attempt = 1; $attempt -le 12; $attempt++) {
            try {
                $health = Invoke-WebRequest -Uri "https://pinefrostdb.com/api/health" -TimeoutSec 20 -UseBasicParsing
                $healthBody = $health.Content | ConvertFrom-Json
                if ($healthBody.status -ne "ok" -or $healthBody.deployment.commit -ne $commitSha) {
                    throw "Health identity mismatch: expected $commitSha, received $($healthBody.deployment.commit)."
                }
                $healthVerified = $true
                break
            } catch {
                $lastHealthError = $_
                if ($attempt -lt 12) {
                    Write-Host "    Health not ready (attempt $attempt/12); retrying in 5 seconds..." -ForegroundColor Yellow
                    Start-Sleep -Seconds 5
                }
            }
        }
        if (-not $healthVerified) {
            throw "New build did not become healthy after 12 attempts: $lastHealthError"
        }
        Invoke-Ssh "printf '%s\n' '$deploymentJson' > '$RemotePath/.deployment.json'"
        Write-Host "    /api/health -> HTTP $($health.StatusCode)" -ForegroundColor Green
        Write-Host "    live build -> $($healthBody.deployment.branch)@$($healthBody.deployment.shortCommit)" -ForegroundColor Green
    } catch {
        if ($restartCompleted) {
            Write-Warning "New build failed health verification. Restoring all last-good images..."
            Invoke-Ssh "for image in $imageList; do docker image inspect `$image:last-good >/dev/null 2>&1 || exit 1; done; for image in $imageList; do docker tag `$image:last-good `$image:latest; done; cd $RemotePath && docker compose up -d --no-deps --no-build --force-recreate $services"
        }
        throw
    }

    Write-Host "==> Done." -ForegroundColor Cyan
    Write-Host "    Backup of the previous deployment: ${RemotePath}-backup-$backupSuffix (remove it once you're confident this deploy is good)."
} finally {
    if ($deployLockAcquired) {
        try {
            Invoke-Ssh "if [ x`$(cat '$deployLockPath/owner' 2>/dev/null) = x'$commitSha' ]; then rm -f '$deployLockPath/owner' && rmdir '$deployLockPath'; else echo 'Deployment lock owner changed; refusing to remove it.'; exit 74; fi"
        } catch {
            Write-Warning "Could not release $deployLockPath automatically. Inspect its owner before the next deployment."
        }
    }
    Pop-Location
}

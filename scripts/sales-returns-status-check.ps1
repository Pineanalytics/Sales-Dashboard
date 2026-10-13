<#
.SYNOPSIS
  Read-only health check for a Centegy Sales & Returns machine (built for Nyeri, works on Nairobi).

.DESCRIPTION
  Answers "why is this branch not extracting?" in one pass, and writes the whole report to
  <ProjectPath>\logs\sales-returns-status-<timestamp>.txt so it can be sent back for review.

  It checks, in order:
    1. the machine (clock, uptime, Node, tsx) and the installed project (scripts, .env keys)
    2. leftovers that force every run into BACKFILL mode (the usual cause of a "backfill error"):
       SALES_RETURNS_BACKFILL_FROM / _TO / SALES_RETURNS_WINDOW set as a user or machine
       environment variable or in .env, and a paused or disabled Smart task
    3. the scheduled tasks (Smart every five minutes, TriggerPoll, retired legacy tasks):
       state, last run, last result code (decoded), next run, and Task Scheduler history
    4. running or stuck sync processes, and whether the machine-wide sync lock is held
    5. the dashboard: reachable, deployed version, this branch's control mode (SMART / CATCHUP)
       and any queued trigger requests
    6. the SQL Server source: TCP reachability (and, with -TestSql, a real login test)

  Nothing is changed. Secrets are never printed (only whether a key is present).
  The two switches below do more, and only when asked:
    -RunNow   runs ONE normal Smart sync in the foreground (the same thing the five-minute task
              runs; it takes the same lock, so it cannot overlap a scheduled run) and captures
              every line of its output, which is where the real error message is.
    -TestSql  opens one SQL connection with the credentials in .env and runs SELECT 1.

  ASCII only on purpose: non-ASCII characters break .ps1 parsing on these machines.

.PARAMETER ProjectPath
  Where the project is installed. Default: the folder above the one this script sits in (so
  D:\SalesDashboard\scripts\sales-returns-status-check.ps1 checks D:\SalesDashboard). Pass it only
  if the script is run from somewhere else.

.PARAMETER Distributor
  Branch code. Default: SALES_RETURNS_DISTRIBUTOR from the environment or .env, else 18058585 (Nyeri).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File D:\SalesDashboard\scripts\sales-returns-status-check.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File D:\SalesDashboard\scripts\sales-returns-status-check.ps1 -RunNow -TestSql
#>

param(
  [string]$ProjectPath = "",
  [string]$AppUrl = "https://pinefrostdb.com",
  [string]$Distributor = $env:SALES_RETURNS_DISTRIBUTOR,
  [string]$SmartTaskName = "SalesDashboard-SalesReturnsSync-Smart",
  [string]$TriggerPollTaskName = "SalesDashboard-TriggerPoll",
  [int]$StaleMinutes = 15,
  [switch]$RunNow,
  [switch]$TestSql
)

$ErrorActionPreference = "Continue"
$script:fails = 0
$script:warns = 0
$script:passes = 0
$script:findings = New-Object System.Collections.ArrayList

function Write-Section { param([string]$Title) Write-Host ""; Write-Host ("=== {0} ===" -f $Title) -ForegroundColor Cyan }

function Add-Check {
  param([ValidateSet("PASS", "WARN", "FAIL", "INFO")][string]$Level, [string]$Name, [string]$Detail = "", [string]$Fix = "")
  $color = "Gray"
  if ($Level -eq "PASS") { $color = "Green"; $script:passes++ }
  elseif ($Level -eq "WARN") { $color = "Yellow"; $script:warns++ }
  elseif ($Level -eq "FAIL") { $color = "Red"; $script:fails++ }
  $line = "[{0}] {1}" -f $Level, $Name
  if ($Detail) { $line = $line + " - " + $Detail }
  Write-Host $line -ForegroundColor $color
  if ($Fix -and ($Level -eq "WARN" -or $Level -eq "FAIL")) {
    Write-Host ("       fix: {0}" -f $Fix) -ForegroundColor DarkYellow
    [void]$script:findings.Add(("{0}: {1}  ->  {2}" -f $Level, $Name, $Fix))
  }
  elseif ($Level -eq "FAIL" -or $Level -eq "WARN") {
    [void]$script:findings.Add(("{0}: {1} {2}" -f $Level, $Name, $Detail))
  }
}

# Task Scheduler result codes that matter here.
function Convert-TaskResult {
  param([int64]$Code)
  $hex = "0x{0:X}" -f ($Code -band 0xFFFFFFFF)
  switch ($Code -band 0xFFFFFFFF) {
    0 { return "$hex (success)" }
    267009 { return "$hex (currently running)" }
    267011 { return "$hex (task has not run yet)" }
    267014 { return "$hex (terminated: the 20 minute limit or someone stopped it)" }
    1 { return "$hex (the script ran and failed: it threw an error; use -RunNow to see the message)" }
    2147942402 { return "$hex (file not found: the script, node or wscript path is wrong)" }
    2147942667 { return "$hex (start-in folder is invalid)" }
    2147750687 { return "$hex (an instance was already running)" }
    default { return "$hex" }
  }
}

function Get-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Where-Object { $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=") } | Select-Object -Last 1
  if (-not $line) { return $null }
  return (($line -replace ("^\s*" + [regex]::Escape($Name) + "\s*=\s*"), "") -replace '^"(.*)"$', '$1')
}

# One GET that does NOT follow redirects, so a 301 shows up as a 301.
function Get-HttpStatusNoRedirect {
  param([string]$Url)
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  try {
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.AllowAutoRedirect = $false
    $req.Timeout = 20000
    $req.Method = "GET"
    $resp = $req.GetResponse()
    $result = @{ Code = [int]$resp.StatusCode; Location = $resp.Headers["Location"]; Error = $null }
    $resp.Close()
    return $result
  }
  catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $result = @{ Code = [int]$resp.StatusCode; Location = $resp.Headers["Location"]; Error = $null }
      $resp.Close()
      return $result
    }
    return @{ Code = 0; Location = $null; Error = $_.Exception.Message }
  }
  catch { return @{ Code = 0; Location = $null; Error = $_.Exception.Message } }
}

function Get-DotEnvCount {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  return @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Where-Object { $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=") }).Count
}

# ---------------------------------------------------------------- locate the project and start the report file
if (-not $ProjectPath) {
  # Installed layout: <project>\scripts\sales-returns-status-check.ps1
  $ProjectPath = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath ".env"))) {
  foreach ($candidate in @("D:\SalesDashboard", "C:\SalesDashboard", "D:\Reports & Extractions\Sales Dashboard")) {
    if (Test-Path -LiteralPath (Join-Path $candidate ".env")) { $ProjectPath = $candidate; break }
  }
}
$logDir = Join-Path $ProjectPath "logs"
$reportPath = $null
try {
  if (Test-Path -LiteralPath $ProjectPath) {
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $reportPath = Join-Path $logDir ("sales-returns-status-{0:yyyyMMdd-HHmmss}.txt" -f (Get-Date))
    Start-Transcript -Path $reportPath -Force | Out-Null
  }
}
catch { $reportPath = $null }

Write-Host "Sales & Returns status check" -ForegroundColor White
Write-Host ("Started {0:yyyy-MM-dd HH:mm:ss} on {1} as {2}\{3}" -f (Get-Date), $env:COMPUTERNAME, $env:USERDOMAIN, $env:USERNAME)

$envPath = Join-Path $ProjectPath ".env"
if (-not $Distributor) { $Distributor = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_DISTRIBUTOR" }
if (-not $Distributor) { $Distributor = "18058585" }
$branchName = "unknown branch"
if ($Distributor -eq "18058585") { $branchName = "Nyeri" } elseif ($Distributor -eq "18048241") { $branchName = "Nairobi" }
Write-Host ("Branch: {0} ({1})   Project: {2}" -f $branchName, $Distributor, $ProjectPath)

# ---------------------------------------------------------------- 1. machine and install
Write-Section "1. Machine and installed project"
$now = Get-Date
Add-Check "INFO" "Local time" ("{0:yyyy-MM-dd HH:mm:ss} ({1})" -f $now, [System.TimeZoneInfo]::Local.Id)
try {
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  $up = New-TimeSpan -Start $boot -End $now
  Add-Check "INFO" "Last boot" ("{0:yyyy-MM-dd HH:mm} (up {1}d {2}h)" -f $boot, $up.Days, $up.Hours)
}
catch { Add-Check "INFO" "Last boot" "could not be read" }

if (Test-Path -LiteralPath $ProjectPath) { Add-Check "PASS" "Project folder exists" $ProjectPath }
else { Add-Check "FAIL" "Project folder missing" $ProjectPath "Pass -ProjectPath with the folder the project is installed in." }

foreach ($rel in @("scripts\sales-returns-sync.ps1", "scripts\sales-returns-sync-lock.ps1", "scripts\sales-returns-trigger-poll.ps1", "scripts\run-hidden.vbs", "scripts\db-bridge\sales-returns\run.ts", "node_modules\tsx", "node_modules\mssql")) {
  $p = Join-Path $ProjectPath $rel
  if (Test-Path -LiteralPath $p) {
    $when = (Get-Item -LiteralPath $p).LastWriteTime
    Add-Check "PASS" ("Present: " + $rel) ("last changed {0:yyyy-MM-dd HH:mm}" -f $when)
  }
  else {
    Add-Check "FAIL" ("Missing: " + $rel) "" "Reinstall the merged script revision on this machine (a VPS deployment cannot update it); run npm install in the project folder if node_modules is missing."
  }
}

$nodeVersion = $null
try { $nodeVersion = (& node --version) 2>$null } catch { $nodeVersion = $null }
if ($nodeVersion) { Add-Check "PASS" "Node.js" $nodeVersion }
else { Add-Check "FAIL" "Node.js not found on PATH for this user" "" "Install Node.js 20+ or add it to PATH; the scheduled task runs as the logged-on user." }

# .env keys (names only, never values)
if (Test-Path -LiteralPath $envPath) {
  foreach ($key in @("UPLOAD_API_KEY", "SALES_RETURNS_DISTRIBUTOR", "SALES_RETURNS_SQL_SERVER", "SALES_RETURNS_SQL_DATABASE", "SALES_RETURNS_SQL_USER", "SALES_RETURNS_SQL_PASSWORD")) {
    $value = Get-DotEnvValue -Path $envPath -Name $key
    $count = Get-DotEnvCount -Path $envPath -Name $key
    if ([string]::IsNullOrWhiteSpace($value)) { Add-Check "FAIL" (".env " + $key) "missing or empty" ("Set " + $key + " in " + $envPath) }
    elseif ($count -gt 1) { Add-Check "WARN" (".env " + $key) ("present, defined {0} times (the last one wins)" -f $count) "Remove the stale duplicate lines." }
    else { Add-Check "PASS" (".env " + $key) "present" }
  }
  $envDistributor = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_DISTRIBUTOR"
  if ($envDistributor -and $envDistributor -ne $Distributor) { Add-Check "WARN" "Distributor mismatch" (".env says {0}, this check is for {1}" -f $envDistributor, $Distributor) "Run the check with -Distributor $envDistributor if this machine is that branch." }
}
else { Add-Check "FAIL" ".env not found" $envPath "Create it from the installation notes; the sync cannot run without it." }

# ---------------------------------------------------------------- 2. things that force backfill mode
Write-Section "2. Leftovers that force every run into backfill mode"
$forcing = $false
foreach ($name in @("SALES_RETURNS_BACKFILL_FROM", "SALES_RETURNS_BACKFILL_TO", "SALES_RETURNS_WINDOW")) {
  foreach ($scope in @("User", "Machine")) {
    $value = [Environment]::GetEnvironmentVariable($name, $scope)
    if ($value) {
      $forcing = $true
      Add-Check "FAIL" ("{0} is set as a {1} environment variable" -f $name, $scope.ToLower()) ("value: " + $value) ("Remove it: [Environment]::SetEnvironmentVariable('" + $name + "', `$null, '" + $scope + "') and start a new session. A permanent value makes every five-minute run a backfill, which the dashboard refuses (409) once the branch is in catch-up mode.")
    }
  }
  $fileValue = Get-DotEnvValue -Path $envPath -Name $name
  if ($fileValue) {
    $forcing = $true
    Add-Check "FAIL" ("{0} is set in .env" -f $name) ("value: " + $fileValue) ("Delete that line from " + $envPath + ". The wrapper sets it only for a single manual backfill run and removes it afterwards.")
  }
}
if (-not $forcing) { Add-Check "PASS" "No backfill or window override is stored in the environment or .env" }

# ---------------------------------------------------------------- 3. scheduled tasks
Write-Section "3. Scheduled tasks"
$smartFound = $false
try {
  $all = @(Get-ScheduledTask -ErrorAction Stop)
  $related = @($all | Where-Object {
      $_.TaskName -match "SalesDashboard" -or ($_.Actions | Where-Object { ($_.Arguments + " " + $_.Execute) -match "sales-returns" })
    })
  if ($related.Count -eq 0) { Add-Check "FAIL" "No Sales & Returns scheduled task exists on this machine" "" "Run scripts\install-sales-returns-sync-schedule.ps1 -ProjectPath $ProjectPath" }
  foreach ($task in $related) {
    $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
    $isSmart = ($task.TaskName -eq $SmartTaskName)
    $isPoll = ($task.TaskName -eq $TriggerPollTaskName)
    $isLegacy = ($task.TaskName -match "SalesReturnsSync-(Morning|Midday|Evening|FiveMinute)")
    $label = "Task " + $task.TaskName
    $state = [string]$task.State
    if ($isSmart) { $smartFound = $true }
    $last = $null
    if ($info) { $last = $info.LastRunTime }
    $ageText = "never run"
    $ageMinutes = $null
    if ($last -and $last.Year -gt 2000) { $ageMinutes = [math]::Round((New-TimeSpan -Start $last -End $now).TotalMinutes, 0); $ageText = ("{0:yyyy-MM-dd HH:mm} ({1} min ago)" -f $last, $ageMinutes) }
    $result = "n/a"
    if ($info) { $result = Convert-TaskResult -Code $info.LastTaskResult }
    $nextText = "n/a"
    if ($info -and $info.NextRunTime -and $info.NextRunTime.Year -gt 2000) { $nextText = ("{0:yyyy-MM-dd HH:mm}" -f $info.NextRunTime) }
    $detail = "state {0}; last run {1}; last result {2}; next run {3}" -f $state, $ageText, $result, $nextText

    if ($isLegacy) {
      if ($state -eq "Disabled") { Add-Check "PASS" $label "retired legacy task, disabled as intended" }
      else { Add-Check "WARN" $label ("retired legacy task is " + $state) ("Disable-ScheduledTask -TaskName '" + $task.TaskName + "'") }
      continue
    }
    if ($isSmart) {
      if ($state -eq "Disabled") { Add-Check "FAIL" $label ("DISABLED. " + $detail) ("Enable-ScheduledTask -TaskName '" + $SmartTaskName + "'  (a task paused for a backfill and never re-enabled is the usual reason a branch goes quiet)") }
      elseif ($info -and $info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009 -and $info.LastTaskResult -ne 267011) { Add-Check "FAIL" $label $detail "Re-run this check with -RunNow to see the error message the task hides." }
      elseif ($null -ne $ageMinutes -and $ageMinutes -gt $StaleMinutes -and $state -ne "Running") { Add-Check "FAIL" $label ("has not run for {0} minutes (it should run every 5). {1}" -f $ageMinutes, $detail) "Check the machine was on, the user is logged on (the task runs Interactive), and the task is not Disabled." }
      elseif ($null -eq $ageMinutes) { Add-Check "WARN" $label $detail "The task exists but has never run." }
      else { Add-Check "PASS" $label $detail }
      $triggers = @($task.Triggers)
      if ($triggers.Count -gt 0) {
        $rep = $triggers[0].Repetition
        if ($rep -and $rep.Interval) { Add-Check "INFO" "Smart task repeats every" ([string]$rep.Interval) }
      }
      if ([string]$task.Principal.LogonType -eq "Interactive") { Add-Check "INFO" "Smart task logon type" ("Interactive as " + $task.Principal.UserId + " - it only runs while that user is logged on") }
      continue
    }
    if ($isPoll) {
      if ($state -eq "Disabled") { Add-Check "WARN" $label ("disabled. " + $detail) "Enable it only if dashboard-queued 'Trigger now' runs are wanted on this machine." }
      elseif ($info -and $info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009 -and $info.LastTaskResult -ne 267011) { Add-Check "WARN" $label $detail "The trigger poll is failing; this does not stop the Smart task." }
      else { Add-Check "PASS" $label $detail }
      continue
    }
    Add-Check "INFO" $label $detail
  }
  if (-not $smartFound) { Add-Check "FAIL" ("Smart task '" + $SmartTaskName + "' not found") "" "Run scripts\install-sales-returns-sync-schedule.ps1 -ProjectPath $ProjectPath" }
}
catch { Add-Check "WARN" "Could not read scheduled tasks" $_.Exception.Message "Run this script from an elevated or the same user's PowerShell." }

# Task Scheduler history (may be switched off on a machine; then it simply says so)
try {
  $events = @(Get-WinEvent -LogName "Microsoft-Windows-TaskScheduler/Operational" -MaxEvents 3000 -ErrorAction Stop |
      Where-Object { $_.Message -match [regex]::Escape($SmartTaskName) -and $_.TimeCreated -gt $now.AddHours(-48) })
  if ($events.Count -eq 0) { Add-Check "WARN" "Task Scheduler history" "no events for the Smart task in the last 48 hours" "Either history is off (Task Scheduler > Enable All Tasks History) or the task has not run." }
  else {
    $starts = @($events | Where-Object { $_.Id -eq 100 }).Count
    $fails = @($events | Where-Object { $_.Id -in 101, 103, 202, 203 }).Count
    $first = ($events | Sort-Object TimeCreated | Select-Object -First 1).TimeCreated
    $lastEvent = ($events | Sort-Object TimeCreated | Select-Object -Last 1).TimeCreated
    Add-Check "INFO" "Task Scheduler history (48 h)" ("{0} start events, {1} failure events, from {2:MM-dd HH:mm} to {3:MM-dd HH:mm}" -f $starts, $fails, $first, $lastEvent)
    $recentFails = $events | Where-Object { $_.Id -in 101, 103, 202, 203 } | Sort-Object TimeCreated -Descending | Select-Object -First 3
    foreach ($e in $recentFails) { Add-Check "WARN" ("History: event {0} at {1:MM-dd HH:mm}" -f $e.Id, $e.TimeCreated) (($e.Message -split "`r?`n")[0]) }
  }
}
catch { Add-Check "INFO" "Task Scheduler history" "not readable (log disabled or no permission)" }

# ---------------------------------------------------------------- 4. processes and the lock
Write-Section "4. Running processes and the sync lock"
try {
  $procs = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine -match "sales-returns" -and $_.ProcessId -ne $PID })
  if ($procs.Count -eq 0) { Add-Check "PASS" "No Sales & Returns sync process is running right now" }
  foreach ($p in $procs) {
    $started = $null
    try { $started = [Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate) } catch { $started = $null }
    $mins = $null
    if ($started) { $mins = [math]::Round((New-TimeSpan -Start $started -End $now).TotalMinutes, 0) }
    $short = $p.CommandLine
    if ($short.Length -gt 140) { $short = $short.Substring(0, 140) + "..." }
    if ($mins -ne $null -and $mins -gt 20) { Add-Check "FAIL" ("{0} (pid {1}) running for {2} minutes" -f $p.Name, $p.ProcessId, $mins) $short ("Stop-Process -Id " + $p.ProcessId + " -Force  (it holds the lock and every later run skips; the task's own limit is 20 minutes)") }
    else { Add-Check "INFO" ("{0} (pid {1}) running" -f $p.Name, $p.ProcessId) ("{0} min; {1}" -f $mins, $short) }
  }
}
catch { Add-Check "INFO" "Process list" "could not be read" }

if ($Distributor -match '^\d+$') {
  $mutex = $null
  try {
    $mutex = New-Object System.Threading.Mutex($false, "Global\Pinefrost-SalesReturnsSync-$Distributor")
    $got = $false
    try { $got = $mutex.WaitOne(0, $false) } catch [System.Threading.AbandonedMutexException] { $got = $true }
    if ($got) { Add-Check "PASS" "Sync lock is free" "nothing is holding Global\Pinefrost-SalesReturnsSync-$Distributor"; [void]$mutex.ReleaseMutex() }
    else { Add-Check "WARN" "Sync lock is held" "a sync (scheduled, trigger or manual backfill) is running right now; if no process is listed above it is stuck" "Wait for it to finish; if it has run for more than 20 minutes stop the node/powershell process shown above." }
  }
  catch { Add-Check "INFO" "Sync lock" ("could not be tested: " + $_.Exception.Message) }
  finally { if ($mutex) { $mutex.Dispose() } }
}

# ---------------------------------------------------------------- 5. the dashboard
Write-Section "5. Dashboard (VPS)"
$apiKey = Get-DotEnvValue -Path $envPath -Name "UPLOAD_API_KEY"

# The address the sync really uses: SALES_RETURNS_APP_URL (environment, then .env), else the script default (the apex).
$configuredUrl = $env:SALES_RETURNS_APP_URL
if (-not $configuredUrl) { $configuredUrl = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_APP_URL" }
$effectiveUrl = $AppUrl
if ($configuredUrl) { $effectiveUrl = $configuredUrl.Trim().TrimEnd('/') }
Add-Check "INFO" "Dashboard address the sync uses" $effectiveUrl
foreach ($urlName in @("SALES_RETURNS_APP_URL", "PL_BRIDGE_APP_URL", "EABL_CALL_APP_URL")) {
  $urlValue = $null
  if (Get-Item -Path ("Env:" + $urlName) -ErrorAction SilentlyContinue) { $urlValue = (Get-Item -Path ("Env:" + $urlName)).Value }
  if (-not $urlValue) { $urlValue = Get-DotEnvValue -Path $envPath -Name $urlName }
  if ($urlValue -and $urlValue -match "://www\.") {
    Add-Check "FAIL" ($urlName + " names the www host") ("value: " + $urlValue) ("Change it to https://pinefrostdb.com (no www) in " + $envPath + " or remove the line. The www address answers with a redirect, and a redirected upload arrives as a GET, so uploads fail.")
  }
}
if ($AppUrl -match "://www\.") { Add-Check "FAIL" "-AppUrl names the www host" $AppUrl "Use https://pinefrostdb.com." }
$probe = Get-HttpStatusNoRedirect -Url ($effectiveUrl + "/api/health")
if ($probe.Code -ge 200 -and $probe.Code -lt 300) { Add-Check "PASS" "Dashboard address answers directly (no redirect)" ("HTTP " + $probe.Code) }
elseif ($probe.Code -ge 300 -and $probe.Code -lt 400) { Add-Check "FAIL" "The dashboard address redirects" ("HTTP " + $probe.Code + " from " + $effectiveUrl + " to " + $probe.Location) "Use the canonical address https://pinefrostdb.com for SALES_RETURNS_APP_URL. Uploads sent to a redirecting address fail." }
elseif ($probe.Code -gt 0) { Add-Check "WARN" "Dashboard address answered with an error" ("HTTP " + $probe.Code + " from " + $effectiveUrl) }
else { Add-Check "FAIL" "Cannot connect to the dashboard address" ($effectiveUrl + ": " + $probe.Error) "Check the address, this machine's internet and any proxy or firewall." }
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch { }
try {
  $web = Invoke-WebRequest -Uri "$effectiveUrl/api/health" -UseBasicParsing -TimeoutSec 20
  $health = $web.Content | ConvertFrom-Json
  $commit = $null
  if ($health.deployment) { $commit = $health.deployment.shortCommit }
  Add-Check "PASS" "Dashboard reachable" ("HTTP {0}; status {1}; database {2}; build {3}" -f $web.StatusCode, $health.status, $health.database, $commit)
  try {
    $serverTime = [datetime]::Parse($web.Headers["Date"]).ToUniversalTime()
    $drift = [math]::Abs((New-TimeSpan -Start $serverTime -End (Get-Date).ToUniversalTime()).TotalSeconds)
    if ($drift -gt 120) { Add-Check "WARN" "Clock drift" ("this machine is {0:N0} seconds away from the dashboard server" -f $drift) "Resync the Windows clock (w32tm /resync); a wrong clock makes the Smart window mis-pick days." }
    else { Add-Check "PASS" "Clock in sync with the dashboard" ("{0:N0} s difference" -f $drift) }
  }
  catch { }
}
catch { Add-Check "FAIL" "Dashboard not reachable" $_.Exception.Message "Check this machine's internet/proxy; the sync cannot upload without it." }

if ($apiKey) {
  try {
    $control = Invoke-RestMethod -Uri "$effectiveUrl/api/sales-returns/control?distributor=$Distributor" -Method Get -Headers @{ "x-upload-api-key" = $apiKey } -TimeoutSec 20
    $detail = "mode {0}; version {1}; status {2}" -f $control.desiredMode, $control.version, $control.status
    if ($control.resultSummary) { $detail = $detail + "; last result: " + $control.resultSummary }
    if ($control.desiredMode -eq "CATCHUP") { Add-Check "FAIL" "Branch control is in CATCHUP (backfill pause)" $detail "An admin must set the branch back to SMART on the dashboard (Admin > Dataset > Sync Health). While it is CATCHUP the dashboard refuses historical windows with HTTP 409 and the machine reports a backfill error." }
    elseif ($control.status -eq "FAILED") { Add-Check "FAIL" "Branch control last acknowledged as FAILED" $detail "The last run reported a failure; use -RunNow to see why." }
    elseif ($control.status -eq "PENDING") { Add-Check "WARN" "Branch control change not yet acknowledged by this machine" $detail "The Smart task has not run since the admin changed the mode; check the task above." }
    else { Add-Check "PASS" "Branch control" $detail }
  }
  catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401) { Add-Check "FAIL" "Dashboard rejected UPLOAD_API_KEY (401)" "" "The key in .env does not match the VPS key; every upload fails. Ask the admin for the current key (do not paste it into chat)." }
    else { Add-Check "WARN" "Could not read branch control" $_.Exception.Message }
  }
  try {
    $pending = Invoke-RestMethod -Uri "$effectiveUrl/api/sales-returns/trigger/pending?distributor=$Distributor" -Method Get -Headers @{ "x-upload-api-key" = $apiKey } -TimeoutSec 20
    if ($pending.pending) { Add-Check "INFO" "A dashboard 'Trigger now' request is waiting for this machine" ("window {0} {1}" -f $pending.window, $pending.date) }
    else { Add-Check "PASS" "No queued trigger requests for this branch" }
  }
  catch { Add-Check "INFO" "Trigger queue" "could not be read" }
}
else { Add-Check "WARN" "Skipped dashboard control checks" "no UPLOAD_API_KEY in .env" "Add UPLOAD_API_KEY to .env." }

# ---------------------------------------------------------------- 6. SQL source
Write-Section "6. SQL Server source"
$sqlServer = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_SQL_SERVER"
$sqlPort = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_SQL_PORT"
$sqlInstance = Get-DotEnvValue -Path $envPath -Name "SALES_RETURNS_SQL_INSTANCE"
if (-not $sqlPort) { $sqlPort = "1433" }
if ($sqlServer -and -not $sqlInstance) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $task = $tcp.ConnectAsync($sqlServer, [int]$sqlPort)
    if ($task.Wait(8000) -and $tcp.Connected) { Add-Check "PASS" "SQL Server reachable" ("{0}:{1}" -f $sqlServer, $sqlPort) }
    else { Add-Check "FAIL" "SQL Server not reachable" ("{0}:{1} did not answer within 8 seconds" -f $sqlServer, $sqlPort) "Is the SQL Server service running on this machine/network? Start it, then re-run." }
    $tcp.Close()
  }
  catch { Add-Check "FAIL" "SQL Server not reachable" ("{0}:{1}  {2}" -f $sqlServer, $sqlPort, $_.Exception.InnerException.Message) "Is the SQL Server service running? Check the .env server name and port." }
}
elseif ($sqlInstance) { Add-Check "INFO" "SQL named instance in use" ("{0}\{1} (port check skipped; use -TestSql for a real login)" -f $sqlServer, $sqlInstance) }
else { Add-Check "INFO" "SQL server not configured in .env" "" }

if ($TestSql) {
  $testScript = Join-Path $env:TEMP "sr-sqltest.cjs"
  $mssqlPath = (Join-Path $ProjectPath "node_modules\mssql").Replace("\", "/")
  $js = @"
const sql = require("$mssqlPath");
(async () => {
  const instance = process.env.SALES_RETURNS_SQL_INSTANCE || undefined;
  const pool = await new sql.ConnectionPool({
    server: process.env.SALES_RETURNS_SQL_SERVER,
    ...(instance ? {} : { port: Number(process.env.SALES_RETURNS_SQL_PORT || 1433) }),
    database: process.env.SALES_RETURNS_SQL_DATABASE,
    user: process.env.SALES_RETURNS_SQL_USER,
    password: process.env.SALES_RETURNS_SQL_PASSWORD,
    connectionTimeout: 15000,
    options: { encrypt: (process.env.SALES_RETURNS_SQL_ENCRYPT || "false") === "true", trustServerCertificate: (process.env.SALES_RETURNS_SQL_TRUST_SERVER_CERT || "true") === "true", ...(instance ? { instanceName: instance } : {}) },
  }).connect();
  const r = await pool.request().query("SELECT 1 AS ok");
  console.log("SQL login ok, SELECT 1 returned " + r.recordset[0].ok);
  await pool.close();
})().catch((e) => { console.error("SQL test failed: " + e.message); process.exit(2); });
"@
  try {
    Set-Content -LiteralPath $testScript -Value $js -Encoding ASCII
    foreach ($key in @("SALES_RETURNS_SQL_SERVER", "SALES_RETURNS_SQL_PORT", "SALES_RETURNS_SQL_INSTANCE", "SALES_RETURNS_SQL_DATABASE", "SALES_RETURNS_SQL_USER", "SALES_RETURNS_SQL_PASSWORD", "SALES_RETURNS_SQL_ENCRYPT", "SALES_RETURNS_SQL_TRUST_SERVER_CERT")) {
      $v = Get-DotEnvValue -Path $envPath -Name $key
      if ($v) { Set-Item -Path ("Env:" + $key) -Value $v }
    }
    $out = & node $testScript 2>&1
    if ($LASTEXITCODE -eq 0) { Add-Check "PASS" "SQL login" (($out | Out-String).Trim()) }
    else { Add-Check "FAIL" "SQL login failed" (($out | Out-String).Trim()) "Check the SQL credentials in .env and that the SQL service accepts logins." }
  }
  catch { Add-Check "FAIL" "SQL test could not run" $_.Exception.Message }
  finally {
    Remove-Item -LiteralPath $testScript -ErrorAction SilentlyContinue
    foreach ($key in @("SALES_RETURNS_SQL_SERVER", "SALES_RETURNS_SQL_PORT", "SALES_RETURNS_SQL_INSTANCE", "SALES_RETURNS_SQL_DATABASE", "SALES_RETURNS_SQL_USER", "SALES_RETURNS_SQL_PASSWORD", "SALES_RETURNS_SQL_ENCRYPT", "SALES_RETURNS_SQL_TRUST_SERVER_CERT")) { Remove-Item -Path ("Env:" + $key) -ErrorAction SilentlyContinue }
  }
}

# ---------------------------------------------------------------- optional: one real Smart run, captured
if ($RunNow) {
  Write-Section "7. One Smart sync run in the foreground (-RunNow)"
  $syncScript = Join-Path $ProjectPath "scripts\sales-returns-sync.ps1"
  if (-not (Test-Path -LiteralPath $syncScript)) { Add-Check "FAIL" "Cannot run: sales-returns-sync.ps1 is missing" $syncScript }
  else {
    $runLog = Join-Path $logDir ("sales-returns-run-{0:yyyyMMdd-HHmmss}.txt" -f (Get-Date))
    Write-Host ("Running: powershell -File sales-returns-sync.ps1 -Window Smart   (output also saved to {0})" -f $runLog)
    $savedPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $syncScript -ProjectPath $ProjectPath -Window Smart 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $savedPref
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`r`n"
    Set-Content -LiteralPath $runLog -Value $text -Encoding UTF8
    Write-Host $text
    if ($code -eq 0 -and $text -notmatch "FAILED") { Add-Check "PASS" "Smart sync run" "finished with exit code 0" }
    else {
      $hint = "Read the lines above: the first error line is the cause."
      if ($text -match "Historical Sales & Returns reconciliation is stopped") { $hint = "The branch control is in CATCHUP on the dashboard: an admin must set it back to SMART." }
      elseif ($text -match "://www\." -or $text -match "301|302|405|Method Not Allowed") { $hint = "The sync used the www address (or a redirecting one): set SALES_RETURNS_APP_URL=https://pinefrostdb.com in .env, or delete that line." }
      elseif ($text -match "409") { $hint = "HTTP 409 from the dashboard: the branch is in catch-up (backfill pause), or the window is historical." }
      elseif ($text -match "ECONNREFUSED|ETIMEOUT|Failed to connect|ESOCKET") { $hint = "The SQL Server could not be reached: start the SQL service or fix the .env server/port." }
      elseif ($text -match "Login failed") { $hint = "SQL login failed: the credentials in .env are wrong or expired." }
      elseif ($text -match "401|Invalid or missing") { $hint = "The dashboard rejected UPLOAD_API_KEY: refresh it in .env." }
      Add-Check "FAIL" ("Smart sync run failed (exit code {0})" -f $code) "see the output above and the saved log" $hint
    }
  }
}

# ---------------------------------------------------------------- summary
Write-Section "Summary"
Write-Host ("{0} passed, {1} warnings, {2} failures" -f $script:passes, $script:warns, $script:fails)
if ($script:findings.Count -gt 0) {
  Write-Host ""
  Write-Host "What to do, most important first:" -ForegroundColor White
  $n = 1
  foreach ($f in $script:findings) { Write-Host ("  {0}. {1}" -f $n, $f); $n++ }
}
else { Write-Host "Nothing needs attention on this machine." -ForegroundColor Green }
if ($reportPath) {
  Write-Host ""
  Write-Host ("Full report saved to: {0}" -f $reportPath)
  try { Stop-Transcript | Out-Null } catch { }
}
if ($script:fails -gt 0) { exit 1 }
exit 0

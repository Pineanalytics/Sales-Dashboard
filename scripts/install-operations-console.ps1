<#
.SYNOPSIS
  Installs the Pinefrost Operations Console as a desktop application launcher.

.DESCRIPTION
  Use -Role Nairobi or -Role Nyeri on the Centegy PCs, and -Role Server on
  PINEFROSTSERVER. The console contains no credentials: it reads each
  machine's existing task and script configuration at run time.
#>
[CmdletBinding()]
param(
  [ValidateSet('Nairobi', 'Nyeri', 'Server')]
  [string]$Role,
  [string]$ProjectPath = 'C:\SalesDashboard',
  [string]$ServerPullerPath = 'C:\ukl-sales-export-pull.ps1',
  [string]$InstallRoot = 'C:\ProgramData\Pinefrost Operations Console'
)

$ErrorActionPreference = 'Stop'
if (-not $Role) { throw 'Specify -Role Nairobi, -Role Nyeri, or -Role Server.' }

$sourceConsole = Join-Path $PSScriptRoot 'operations-console.ps1'
$sourceIcon = @(
  (Join-Path $PSScriptRoot '..\assets\operations-console-icon.png'),
  (Join-Path $PSScriptRoot 'operations-console-icon.png')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not (Test-Path -LiteralPath $sourceConsole)) {
  throw "Missing console source: $sourceConsole"
}
if (-not (Test-Path -LiteralPath $sourceIcon)) {
  throw "Missing console icon: $sourceIcon"
}
if ($Role -ne 'Server' -and -not (Test-Path -LiteralPath (Join-Path $ProjectPath 'scripts\sales-returns-sync.ps1'))) {
  throw "Sales & Returns project or sync wrapper not found at $ProjectPath."
}
if ($Role -eq 'Server' -and -not (Test-Path -LiteralPath $ServerPullerPath)) {
  throw "UKL export puller not found at $ServerPullerPath."
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$installedConsole = Join-Path $InstallRoot 'operations-console.ps1'
Copy-Item -LiteralPath $sourceConsole -Destination $installedConsole -Force
$installedIcon = Join-Path $InstallRoot 'operations-console.ico'

# Desktop shortcuts use .ico files. Build one from the transparent Pinefrost
# network-mark PNG at install time so the source remains a high-resolution
# project asset while Windows receives a native shortcut icon.
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($sourceIcon)
$iconBitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
try {
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, 256, 256))
  $icon = [System.Drawing.Icon]::FromHandle($iconBitmap.GetHicon())
  $iconStream = [System.IO.File]::Open($installedIcon, [System.IO.FileMode]::Create)
  try { $icon.Save($iconStream) }
  finally { $iconStream.Dispose(); $icon.Dispose() }
}
finally {
  $graphics.Dispose()
  $iconBitmap.Dispose()
  $sourceImage.Dispose()
}

$config = [ordered]@{
  role = $Role
  projectPath = $ProjectPath
  serverPullerPath = $ServerPullerPath
  installedAt = (Get-Date).ToString('o')
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'operations-console.json') -Encoding UTF8

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Pinefrost Operations Console.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedConsole`""
$shortcut.WorkingDirectory = $InstallRoot
$shortcut.Description = "Pinefrost Operations Console - $Role"
$shortcut.IconLocation = "$installedIcon,0"
$shortcut.Save()

[pscustomobject]@{
  Role = $Role
  Console = $installedConsole
  Shortcut = $shortcutPath
  ProjectPath = if ($Role -eq 'Server') { 'Not used on Server PC' } else { $ProjectPath }
  ServerPullerPath = if ($Role -eq 'Server') { $ServerPullerPath } else { 'Not used on Centegy PCs' }
} | Format-List

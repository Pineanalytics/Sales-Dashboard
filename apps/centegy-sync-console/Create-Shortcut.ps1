param([Parameter(Mandatory)][ValidateSet('NAIROBI','NYERI')][string]$Branch,[Parameter(Mandatory)][string]$ProjectPath)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
@{branch=$Branch;projectPath=$ProjectPath}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding UTF8
$electron=Join-Path $root 'node_modules\electron\dist\electron.exe'
if(-not(Test-Path -LiteralPath $electron)){throw 'Electron is not installed. Run npm install in this app folder first.'}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonStartMenu'))){
  if(-not $folder){continue}
  $link=$shell.CreateShortcut((Join-Path $folder 'Pinefrost Centegy Sync Console.lnk'))
  $link.TargetPath=$electron;$link.Arguments='.';$link.WorkingDirectory=$root;$link.IconLocation="$root\renderer\pinefrost-icon.png,0";$link.Description="Pinefrost Centegy Sync Console - $Branch";$link.Save()
}
Write-Output "Configured $Branch console at $root"

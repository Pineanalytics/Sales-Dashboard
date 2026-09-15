param([string]$PullerPath='C:\ukl-sales-export-pull.ps1',[string]$UploadsFolder='D:\UKL_INTEGRATION\UPLOADS',[string]$ArchiveFolder='D:\UKL_INTEGRATION\UPLOADS\Archive')
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
@{pullerPath=$PullerPath;uploadsFolder=$UploadsFolder;archiveFolder=$ArchiveFolder}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'config.json') -Encoding UTF8
$electron=Join-Path $root 'node_modules\electron\dist\electron.exe'
if(-not(Test-Path -LiteralPath $electron)){throw 'Electron is not installed. Run npm install in this app folder first.'}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonStartMenu'))){
  if(-not $folder){continue}
  $link=$shell.CreateShortcut((Join-Path $folder 'Pinefrost Server Export Console.lnk'))
  $link.TargetPath=$electron;$link.Arguments='.';$link.WorkingDirectory=$root;$link.IconLocation="$root\renderer\pinefrost-icon.png,0";$link.Description='Pinefrost Server Export Console';$link.Save()
}
Write-Output "Configured Server Export Console at $root"

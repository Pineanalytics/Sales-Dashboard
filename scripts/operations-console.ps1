<#
.SYNOPSIS
  Local Windows GUI for the Pinefrost Sales & Returns and UKL export workflows.

.DESCRIPTION
  Installed separately on Nairobi, Nyeri, and the Server PC. The console only
  invokes the existing machine-local scheduled tasks and scripts; it does not
  store API keys, open inbound ports, or bypass the established mutexes.
#>
[CmdletBinding()]
param([switch]$NoElevation)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Test-ConsoleAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $NoElevation -and -not (Test-ConsoleAdministrator)) {
  $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NoElevation"
  Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList $arguments
  exit
}

$configPath = Join-Path $PSScriptRoot 'operations-console.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  [System.Windows.Forms.MessageBox]::Show("Missing Operations Console configuration: $configPath", 'Pinefrost Operations Console', 'OK', 'Error') | Out-Null
  exit 1
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$role = [string]$config.role
if ($role -notin @('Nairobi', 'Nyeri', 'Server')) {
  throw "Unsupported Operations Console role '$role'."
}

$taskNames = switch ($role) {
  'Nairobi' { @('SalesDashboard-SalesReturnsSync-Smart') }
  'Nyeri' { @('SalesDashboard-SalesReturnsSync-Smart') }
  'Server' {
    @(
      'UKL-SalesExport-Pull',
      'UKL-SalesExport-Pull-Nyeri',
      'UKL-SalesExport-Pull-Nairobi-Boost',
      'UKL-SalesExport-Pull-Nyeri-Boost'
    )
  }
}

function Set-ConsoleStatus {
  param([string]$Message, [System.Drawing.Color]$Color = [System.Drawing.Color]::FromArgb(20, 76, 61))
  $statusLabel.Text = $Message
  $statusLabel.ForeColor = $Color
}

function Get-TaskStatusRows {
  $rows = @()
  foreach ($taskName in $taskNames) {
    try {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
      $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
      $result = if ($info.LastTaskResult -eq 0) { '0 (success)' } elseif ($null -eq $info.LastTaskResult) { '-' } else { [string]$info.LastTaskResult }
      $rows += [pscustomobject]@{
        Task = $task.TaskName
        State = [string]$task.State
        LastRun = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('dd MMM yyyy HH:mm:ss') } else { '-' }
        Result = $result
        NextRun = if ($info.NextRunTime -and $info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToString('dd MMM yyyy HH:mm:ss') } else { '-' }
      }
    }
    catch {
      $rows += [pscustomobject]@{ Task = $taskName; State = 'Missing'; LastRun = '-'; Result = $_.Exception.Message; NextRun = '-' }
    }
  }
  return $rows
}

function Refresh-TaskGrid {
  $grid.Rows.Clear()
  foreach ($row in Get-TaskStatusRows) {
    [void]$grid.Rows.Add($row.Task, $row.State, $row.LastRun, $row.Result, $row.NextRun)
  }
  Set-ConsoleStatus "Status refreshed at $(Get-Date -Format 'HH:mm:ss')."
}

function Get-SelectedTaskName {
  if ($grid.SelectedRows.Count -eq 0) {
    throw 'Select one task first.'
  }
  return [string]$grid.SelectedRows[0].Cells[0].Value
}

function Invoke-TaskCommand {
  param([ValidateSet('Start', 'Stop', 'Enable', 'Disable')] [string]$Action)
  $taskName = Get-SelectedTaskName
  if ($Action -in @('Stop', 'Disable')) {
    $confirmation = [System.Windows.Forms.MessageBox]::Show(
      "$Action $taskName? This affects the live local process.",
      'Confirm operational action',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirmation -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  }
  switch ($Action) {
    'Start' { Start-ScheduledTask -TaskName $taskName -ErrorAction Stop }
    'Stop' { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop }
    'Enable' { Enable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null }
    'Disable' { Disable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null }
  }
  Set-ConsoleStatus "$Action requested for $taskName. Refresh in a few seconds to view the result."
  Start-Sleep -Milliseconds 500
  Refresh-TaskGrid
}

function ConvertTo-CommandLineArgument {
  param([string]$Value)
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-LocalScript {
  param([string]$FilePath, [string[]]$Arguments, [string]$Description)
  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Required script is missing: $FilePath"
  }
  $argumentText = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-CommandLineArgument $FilePath))
  foreach ($argument in $Arguments) {
    if ($argument -match '\s') { $argumentText += ConvertTo-CommandLineArgument $argument } else { $argumentText += $argument }
  }
  Set-ConsoleStatus "$Description is running. This window may pause until it finishes."
  $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $argumentText -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Description exited with code $($process.ExitCode). Check the local task/script log for details."
  }
  Set-ConsoleStatus "$Description completed successfully."
  Refresh-TaskGrid
}

$form = [System.Windows.Forms.Form]::new()
$form.Text = "Pinefrost Operations Console - $role"
$form.StartPosition = 'CenterScreen'
$form.ClientSize = [System.Drawing.Size]::new(1010, 610)
$form.MinimumSize = [System.Drawing.Size]::new(1010, 610)
$form.BackColor = [System.Drawing.Color]::White
$form.Font = [System.Drawing.Font]::new('Segoe UI', 9)
$iconPath = Join-Path $PSScriptRoot 'operations-console.ico'
if (Test-Path -LiteralPath $iconPath) {
  try { $form.Icon = [System.Drawing.Icon]::new($iconPath) } catch { }
}

$title = [System.Windows.Forms.Label]::new()
$title.Text = 'Pinefrost Operations Console'
$title.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 18)
$title.ForeColor = [System.Drawing.Color]::FromArgb(7, 59, 47)
$title.Location = [System.Drawing.Point]::new(24, 20)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = [System.Windows.Forms.Label]::new()
$subtitle.Text = "$role PC - local controls only. Existing task locks and permissions remain in force."
$subtitle.Location = [System.Drawing.Point]::new(26, 55)
$subtitle.AutoSize = $true
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(83, 104, 96)
$form.Controls.Add($subtitle)

$grid = [System.Windows.Forms.DataGridView]::new()
$grid.Location = [System.Drawing.Point]::new(24, 92)
$grid.Size = [System.Drawing.Size]::new(962, 250)
$grid.ReadOnly = $true
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.SelectionMode = 'FullRowSelect'
$grid.MultiSelect = $false
$grid.AutoSizeColumnsMode = 'Fill'
$grid.BackgroundColor = [System.Drawing.Color]::White
$grid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(7, 59, 47)
$grid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White
$grid.EnableHeadersVisualStyles = $false
foreach ($columnName in @('Task', 'State', 'Last run', 'Last result', 'Next run')) {
  [void]$grid.Columns.Add($columnName, $columnName)
}
$form.Controls.Add($grid)

$refreshButton = [System.Windows.Forms.Button]::new()
$refreshButton.Text = 'Refresh status'
$refreshButton.Location = [System.Drawing.Point]::new(24, 360)
$refreshButton.Size = [System.Drawing.Size]::new(130, 34)
$refreshButton.Add_Click({ try { Refresh-TaskGrid } catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) } })
$form.Controls.Add($refreshButton)

$startButton = [System.Windows.Forms.Button]::new()
$startButton.Text = 'Start now'
$startButton.Location = [System.Drawing.Point]::new(166, 360)
$startButton.Size = [System.Drawing.Size]::new(110, 34)
$startButton.Add_Click({ try { Invoke-TaskCommand Start } catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) } })
$form.Controls.Add($startButton)

$stopButton = [System.Windows.Forms.Button]::new()
$stopButton.Text = 'Stop running'
$stopButton.Location = [System.Drawing.Point]::new(288, 360)
$stopButton.Size = [System.Drawing.Size]::new(110, 34)
$stopButton.Add_Click({ try { Invoke-TaskCommand Stop } catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) } })
$form.Controls.Add($stopButton)

$enableButton = [System.Windows.Forms.Button]::new()
$enableButton.Text = 'Enable'
$enableButton.Location = [System.Drawing.Point]::new(410, 360)
$enableButton.Size = [System.Drawing.Size]::new(90, 34)
$enableButton.Add_Click({ try { Invoke-TaskCommand Enable } catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) } })
$form.Controls.Add($enableButton)

$disableButton = [System.Windows.Forms.Button]::new()
$disableButton.Text = 'Disable'
$disableButton.Location = [System.Drawing.Point]::new(512, 360)
$disableButton.Size = [System.Drawing.Size]::new(90, 34)
$disableButton.Add_Click({ try { Invoke-TaskCommand Disable } catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) } })
$form.Controls.Add($disableButton)

$operationBox = [System.Windows.Forms.GroupBox]::new()
$operationBox.Text = if ($role -eq 'Server') { 'Manual UKL export' } else { 'Manual Sales & Returns backfill' }
$operationBox.Location = [System.Drawing.Point]::new(24, 414)
$operationBox.Size = [System.Drawing.Size]::new(962, 112)
$form.Controls.Add($operationBox)

$dateLabel = [System.Windows.Forms.Label]::new()
$dateLabel.Text = 'Date'
$dateLabel.Location = [System.Drawing.Point]::new(18, 32)
$dateLabel.AutoSize = $true
$operationBox.Controls.Add($dateLabel)

$datePicker = [System.Windows.Forms.DateTimePicker]::new()
$datePicker.Format = 'Custom'
$datePicker.CustomFormat = 'yyyy-MM-dd'
$datePicker.Value = (Get-Date).Date
$datePicker.Location = [System.Drawing.Point]::new(18, 53)
$datePicker.Size = [System.Drawing.Size]::new(130, 24)
$operationBox.Controls.Add($datePicker)

if ($role -eq 'Server') {
  $branchLabel = [System.Windows.Forms.Label]::new()
  $branchLabel.Text = 'Branch'
  $branchLabel.Location = [System.Drawing.Point]::new(170, 32)
  $branchLabel.AutoSize = $true
  $operationBox.Controls.Add($branchLabel)

  $branchPicker = [System.Windows.Forms.ComboBox]::new()
  [void]$branchPicker.Items.AddRange([string[]]@('NAIROBI', 'NYERI'))
  $branchPicker.SelectedIndex = 0
  $branchPicker.DropDownStyle = 'DropDownList'
  $branchPicker.Location = [System.Drawing.Point]::new(170, 53)
  $branchPicker.Size = [System.Drawing.Size]::new(120, 24)
  $operationBox.Controls.Add($branchPicker)

  $runDateButton = [System.Windows.Forms.Button]::new()
  $runDateButton.Text = 'Export selected date'
  $runDateButton.Location = [System.Drawing.Point]::new(312, 50)
  $runDateButton.Size = [System.Drawing.Size]::new(160, 30)
  $runDateButton.Add_Click({
    try {
      $file = [string]$config.serverPullerPath
      Invoke-LocalScript -FilePath $file -Arguments @('-Branch', $branchPicker.SelectedItem, '-Date', $datePicker.Value.ToString('yyyy-MM-dd')) -Description "UKL $($branchPicker.SelectedItem) export for $($datePicker.Value.ToString('yyyy-MM-dd'))"
    }
    catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) }
  })
  $operationBox.Controls.Add($runDateButton)
}
else {
  $runDateButton = [System.Windows.Forms.Button]::new()
  $runDateButton.Text = 'Backfill selected date'
  $runDateButton.Location = [System.Drawing.Point]::new(170, 50)
  $runDateButton.Size = [System.Drawing.Size]::new(170, 30)
  $runDateButton.Add_Click({
    try {
      $file = Join-Path ([string]$config.projectPath) 'scripts\sales-returns-sync.ps1'
      Invoke-LocalScript -FilePath $file -Arguments @('-ProjectPath', [string]$config.projectPath, '-BackfillDate', $datePicker.Value.ToString('yyyy-MM-dd')) -Description "Sales & Returns backfill for $($datePicker.Value.ToString('yyyy-MM-dd'))"
    }
    catch { Set-ConsoleStatus $_.Exception.Message ([System.Drawing.Color]::Firebrick) }
  })
  $operationBox.Controls.Add($runDateButton)

  $note = [System.Windows.Forms.Label]::new()
  $note.Text = 'The selected-date action keeps the machine-wide sync lock. If Smart is already running, wait for its next five-minute cycle.'
  $note.Location = [System.Drawing.Point]::new(360, 56)
  $note.Size = [System.Drawing.Size]::new(570, 36)
  $note.ForeColor = [System.Drawing.Color]::FromArgb(83, 104, 96)
  $operationBox.Controls.Add($note)
}

$statusLabel = [System.Windows.Forms.Label]::new()
$statusLabel.Location = [System.Drawing.Point]::new(24, 548)
$statusLabel.Size = [System.Drawing.Size]::new(962, 36)
$statusLabel.Font = [System.Drawing.Font]::new('Segoe UI', 9)
$form.Controls.Add($statusLabel)

$form.Add_Shown({ Refresh-TaskGrid })
[void]$form.ShowDialog()

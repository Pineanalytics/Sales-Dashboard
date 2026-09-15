# Pinefrost Operations Console

A local Windows control panel for the three operational PCs. It does not expose a
network service or store credentials. It runs only the machine-local scripts and
scheduled tasks that are already configured for that PC.

## Roles

| PC | Install role | Available controls |
| --- | --- | --- |
| Nairobi Centegy | `Nairobi` | View Smart task status, start/stop/enable/disable it, and run a selected-date Sales & Returns backfill. |
| Nyeri Centegy | `Nyeri` | View Smart task status, start/stop/enable/disable it, and run a selected-date Sales & Returns backfill. |
| PINEFROSTSERVER | `Server` | View/start/stop/enable/disable the Nairobi/Nyeri hourly and boost UKL tasks, and export one selected date for either branch. |

The console asks for Administrator elevation when opened because task changes
require it. It preserves the existing locks: an overlapping operation is skipped
rather than racing an active sync/export.

## Install

Use an Administrator PowerShell window in a clean checkout of `master`.

```powershell
Set-Location 'C:\SalesDashboard' # use the actual local repository path
git pull --ff-only origin master

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File '.\scripts\install-operations-console.ps1' `
  -Role Nairobi `
  -ProjectPath 'C:\SalesDashboard'
```

Use `-Role Nyeri` and that PC's project path on Nyeri. On the Server PC, first
update `C:\ukl-sales-export-pull.ps1` from
`scripts\ukl-sales-export-pull.ps1`, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File '.\scripts\install-operations-console.ps1' `
  -Role Server `
  -ServerPullerPath 'C:\ukl-sales-export-pull.ps1'
```

The installer creates a **Pinefrost Operations Console** desktop shortcut and
writes only its role/path configuration to `C:\ProgramData\Pinefrost Operations Console`.

## Safety notes

- **Stop running** ends only the currently running task. **Disable** prevents
  future scheduled launches. Use **Enable** followed by **Start now** to resume.
- A selected-date Sales & Returns backfill remains subject to the live branch
  control. If the branch is paused in Catchup mode, restore SMART from the
  dashboard first.
- Server-PC selected-date exports create a new serialised file and keep the
  archive-aware sequence. Historical recovery schedules are not installed.


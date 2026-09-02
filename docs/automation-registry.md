# Automation registry

This file is the operational index for scheduled and machine-to-machine
processes that affect Sales Dashboard data. Update it in the same pull request
as any schedule, ownership, credential-name, endpoint, or deployment-path
change. It contains no secret values.

## Boundaries and source of truth

- **Source code:** `origin/master` is the only production source of truth.
- **VPS application:** `/opt/pinefrost` is a deployed archive, not a working
  directory. Do not edit code there.
- **VPS environment:** `/opt/pinefrost/.env` and `.sync.env` contain protected
  configuration and may be changed only through an approved operational change.
- **Download machine:** versioned scripts are installed from an exact merged
  commit; the installed copy is an artifact, not the source of truth.
- **Deployment checkout:** only the clean master checkout at
  `D:\sales-dashboard-deploy-clean-20260831` may run `scripts/deploy.ps1`.

## Registered processes

| Process | Purpose and flow | Authoritative code/configuration | Runtime and schedule | Output / state | Alerts and notes |
| --- | --- | --- | --- | --- | --- |
| Sales Dashboard application | Serves the dashboard, protected integration endpoints, and sync-health status. | App/API source in this repository; protected VPS environment files. | Docker Compose on the VPS. Deployed only with `scripts/deploy.ps1` from clean `master`. | VPS Postgres and `/api/health` deployment identity. | App changes require a PR, validation, and post-deploy health verification. |
| EABL Sales Export API | Queries the authorised EABL SQL Server source and produces a date-specific headerless CSV plus manifest. | `app/api/integrations/eabl/sales-export/` and `lib/eablSalesExport*.ts`. | Sales Dashboard VPS application; called by the download machine. | HTTP CSV response; no local report archive on the VPS. | Requires `EABL_SALES_EXPORT_KEY`; do not log or reuse it for other integrations. |
| EABL Sales Export puller | Reconciles VPS manifest revisions, validates CSVs, and atomically delivers changed files. | `scripts/eabl-sales-export-pull.ps1`. | `PINEFROSTSERVER`, run by the two tasks below. | `D:\EABL_INTEGRATION\UPLOADS`; state in `D:\EABL_INTEGRATION\EABL_SALES_EXPORT_STATE`; never writes new files to `Archive`. | Uses a named mutex. Failure alerts use the existing pipeline-alert route and its dedicated alert key. |
| EABL Today task | Pulls the current Nairobi-day export after the upstream hourly upload. | `scripts/install-eabl-sales-export-schedule.ps1`. | `PINEFROSTSERVER` task **Pinefrost EABL Sales Export Today**: daily, hourly at **09:05–21:05** Africa/Nairobi. | Same as EABL puller. | `ScheduleMode Today`; unchanged VPS revision does not cause a new download. |
| EABL Close task | Finalises today and requires a valid yesterday export after the last upstream upload. | `scripts/install-eabl-sales-export-schedule.ps1`. | `PINEFROSTSERVER` task **Pinefrost EABL Sales Export Close**: daily at **22:05** Africa/Nairobi. | Same as EABL puller. | `ScheduleMode Close`; missing qualifying yesterday data is actionable and sends a failure alert. |
| EABL downstream consumer | Consumes successfully delivered files and may archive them after consumption. | **Not yet inventoried in this repository.** | Separate process on `PINEFROSTSERVER`; schedule/owner must be recorded before it is changed. | Reads `D:\EABL_INTEGRATION\UPLOADS`; may move successfully consumed files to `Archive`. | It must never delete an unconsumed file. Archive presence remains successful delivery for the EABL puller. |
| SAP / dashboard sync workers | Dashboard data synchronization workers and their Windows wrappers. | `scripts/db-bridge/`, `scripts/sales-sync.ps1`, `scripts/pl-sync.ps1`, and other documented worker scripts. | See each task definition and Docker Compose service. | Dashboard Postgres and Sync Health. | Add the exact task/service name, owner, schedule, source, and alert route here before changing an individual worker. |

## Required information for a new or changed automation

Before a process is enabled or modified, add or update its registry entry with:

1. process and task/service name;
2. business owner and technical owner;
3. source system, destination, and any archive/retention behavior;
4. time zone, trigger times, overlap policy, and missed-run behavior;
5. exact source script/service and deployment method;
6. secret **environment-variable names only** (never values);
7. health signal, log location, alert route, and recovery action.

## Operating checks

- VPS application identity: `GET /api/health` must return HTTP 200 and the
  expected master commit.
- EABL tasks: inspect both task names with `Get-ScheduledTaskInfo` on
  `PINEFROSTSERVER`.
- EABL delivery: check the newest `EABL_*.csv` in `UPLOADS`, then `Archive`,
  and inspect the state JSON. Do not assume a file is missing merely because a
  consumer moved it to `Archive`.
- An automation with unknown ownership, schedule, or destination is not safe to
  modify; inventory it first.

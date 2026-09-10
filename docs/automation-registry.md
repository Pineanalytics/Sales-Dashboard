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
| UKL Sales Export API | Publishes branch-scoped, headerless Sales & Returns CSVs and content-derived yesterday/today manifests from VPS `SalesReturnLine` facts. | `app/api/integrations/ukl/sales-export/route.ts` and `lib/uklSalesExportManifest.ts`. | Sales Dashboard VPS application; called outbound by `PINEFROSTSERVER`. | HTTP CSV/manifest response; no VPS report-file archive. | Requires `UKL_SALES_EXPORT_KEY`. Content revisions stay stable when a source partition is merely reloaded without changed transactions. |
| UKL Nairobi puller | Reconciles Nairobi UKL files into the watched server folder. | `scripts/ukl-sales-export-pull.ps1` and `scripts/install-ukl-sales-export-schedule.ps1`; puller installed as `C:\ukl-sales-export-pull.ps1`. | `PINEFROSTSERVER` task **UKL-SalesExport-Pull**, hourly at :05 Africa/Nairobi. | `D:\UKL_INTEGRATION\UPLOADS`; state at `D:\UKL_INTEGRATION\UKL_SALES_EXPORT_STATE\ukl-sales-export-NAIROBI.json`; downstream archive at `D:\UKL_INTEGRATION\UPLOADS\Archive`. | Each saved run uses `UKL_NAIROBI_<DD.MM.YYYY>_<NNN>.csv`, beginning at `_001` and increasing without overwriting prior files. It is intentionally staggered ahead of Nyeri and the shared puller mutex serializes file writes. Uses `UKL_SALES_EXPORT_KEY` and optionally `PIPELINE_ALERT_KEY`. |
| UKL Nyeri puller | Reconciles Nyeri UKL files into the watched server folder. | `scripts/ukl-sales-export-pull.ps1` and `scripts/install-ukl-sales-export-schedule.ps1`; puller installed as `C:\ukl-sales-export-pull.ps1`. | `PINEFROSTSERVER` task **UKL-SalesExport-Pull-Nyeri**, hourly at :25 Africa/Nairobi. | `D:\UKL_INTEGRATION\UPLOADS`; state at `D:\UKL_INTEGRATION\UKL_SALES_EXPORT_STATE\ukl-sales-export-NYERI.json`; downstream archive at `D:\UKL_INTEGRATION\UPLOADS\Archive`. | Each saved run uses `UKL_NYERI_<DD.MM.YYYY>_<NNN>.csv`, beginning at `_001` and increasing without overwriting prior files. The 20-minute offset and shared puller mutex prevent competing writes. Uses `UKL_SALES_EXPORT_KEY` and optionally `PIPELINE_ALERT_KEY`. |
| UKL Sales & Returns Server-PC trigger poll | Delivers an administrator-selected Nairobi or Nyeri month as individual date-specific CSVs. The dashboard queues date jobs; the Server PC claims one per poll and runs the existing UKL puller. | `UklSalesExportTriggerRequest`, `/api/integrations/ukl/sales-export/trigger/*`, `scripts/ukl-sales-export-pull.ps1`, and `scripts/install-ukl-sales-export-trigger-poll.ps1`. | `PINEFROSTSERVER` task **Pinefrost UKL Sales Export Trigger Poll**, hourly at :45 Africa/Nairobi. It claims one job only; overlapping runs are ignored and abandoned claims retry on the next hourly poll after 55 minutes. | `D:\UKL_INTEGRATION\UPLOADS`; consumed files may be retained or archived by the existing downstream process. | Uses `UKL_SALES_EXPORT_KEY`; task result and queue status are visible on Dataset Management. Business owner: Sales Operations; technical owner: Sales Dashboard platform. |
| SAP receivables sync | Mirrors SAP payment terms (OCTG), customer credit master (OCRD), and open customer ledger items (JDT1) into the dashboard ageing module. It is dashboard-only and never writes credit terms, limits, or balances to SAP. | `scripts/db-bridge/receivables/query.ts`, `scripts/db-bridge/receivables/run.ts`, `/api/receivables/upload`, and the `sap-sync-worker` Compose service. | `sap-sync-worker` job **receivables**, every 30 minutes in Africa/Nairobi; runs once at worker start, with the worker serializing jobs so runs do not overlap. A missed run is retried on the next interval. | `CreditTerm`, `CustomerCreditProfile`, `ReceivableOpenItem`, and immutable `ReceivablesSyncRun` rows in dashboard Postgres; no report-file archive. | Business owner: Finance/Credit Control. Technical owner: Sales Dashboard platform. Uses `SQLBRIDGE_*` and `UPLOAD_API_KEY` only. Sync Health is the freshness signal; inspect `sap-sync-worker` logs and run `receivables:sync` after repairing the read-only source connection. |
| SAP sales actuals sync | Reads SAP invoice and credit-note lines, maps Product Master items to dashboard principals, and preserves otherwise excluded item-code sales as a Product Master review worklist. It carries read-only SAP `NumInBuy`, current net Purchase Price, and pack/UOM detail for the review-form prefills; it never writes to SAP. | `scripts/sales-sync.ps1`, `scripts/db-bridge/sales-sync.ts`, `scripts/db-bridge/transform/buildUnmappedProductSales.ts`, and `/api/sales/upload-unmapped-products`. | `PINEFROSTSERVER` task **SalesDashboard-SalesSync**, every 30 minutes in Africa/Nairobi, routine current-month mode only. `-Backfill` is a manual, one-off historical run; it is never scheduled. | `SalesRecord`, daily/rep/customer SAP actuals, and `UnmappedProductSale` at item/month/warehouse grain. The Product Master page provides the reviewed mapping worklist, SAP product-reference prefills, and CSV round-trip. | Business owner: Sales Operations. Technical owner: Sales Dashboard platform. Uses read-only `SQLBRIDGE_*`, `UPLOAD_API_KEY`, and a short-lived VPS Postgres tunnel. After a merged change to `sales-sync.ps1` or `sales-sync.ts`, install the exact merged artifact on the scheduler host and verify **SalesDashboard-SalesSync** remains unchanged before a controlled manual `-Backfill`. |
| Sales & Returns branch sync | Reads the Centegy Sales & Returns source for Nairobi and Nyeri and replaces the selected distributor/date partition in the four dashboard report tables. | `scripts/db-bridge/sales-returns/run.ts`, `scripts/sales-returns-sync.ps1`, and `/api/sales-returns/*` upload routes. | Isolated Nairobi and Nyeri Windows Task Scheduler machines; the installed task controls the interval in Africa/Nairobi. Runs must not overlap on one machine; smart mode retries the oldest mismatched date on the next invocation. | Replace-in-place report facts plus immutable `SalesReturnsExtractionRun` audit rows. Each actual extraction receives `SR-<branch>-<UTC timestamp>-<suffix>`; the serial is audit metadata and never changes fact uniqueness. | Business owner: Sales Operations. Technical owner: Sales Dashboard platform. Uses `SALES_RETURNS_*`, `UPLOAD_API_KEY`, and optionally `PIPELINE_ALERT_KEY`. Sync Health shows the latest serial. Install the merged script revision on both isolated machines; a VPS deployment alone cannot update them. |
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

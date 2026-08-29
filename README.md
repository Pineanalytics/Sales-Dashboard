# Pinefrost Limited Performance Dashboard

A production-grade Next.js dashboard for a Kenya-based distributor to track principal (brand/supplier) sales performance — revenue vs. target, rep performance, coverage & productivity, customer/brand mix, profitability, and stock — carrying a full **monthly time series** (not just a single "current" snapshot). A global period selector lets any report be read for MTD, a specific past month, QTD, YTD, a full quarter (Q1–Q4), or a full half (H1/H2), plus YoY/MoM growth comparisons. Sales figures (Revenue/COGS/Gross Profit) are sourced live from a direct SAP SQL bridge; Stock, Coverage, and Brand & Customer data still come from a monthly Excel export. Accounts are self-service: anyone can request access at `/register`, an **admin** approves or rejects the request and controls exactly which reports each **viewer** can see.

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **NextAuth (Auth.js) v5** — credentials login, JWT sessions, `ADMIN`/`VIEWER`/`TEAM_LEADER`/`SUPERVISOR` roles
- **Tailwind CSS v4** for the light Fluent-inspired theme, using CSS variables (`app/globals.css`) as design tokens
- **Recharts** for line/bar/doughnut/composed charts
- **SheetJS (`xlsx`)** for parsing the uploaded workbook, shared between client preview and server persistence
- **Zustand** for global client state (dataset, principal filter, active view, selected period)
- **Prisma + Postgres** for persisting uploaded snapshots and user accounts
- **Vitest** for parser unit tests

Deploys to a self-hosted Hostinger VPS — Docker Compose running the app, Postgres, and Caddy (automatic HTTPS) — see [Deploying](#deploying) below.

## Getting started

### Prerequisites

- Node.js 18.18+ (Node 20+ recommended)

### Setup

```bash
npm install
cp .env.example .env      # set DATABASE_URL, DIRECT_URL and AUTH_SECRET (see below)
npx prisma db push        # creates the Snapshot/User tables
npm run db:seed           # creates a starter admin + viewer account
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/login`. Sign in with one of the seeded accounts (see below), then, as an admin, upload the monthly Excel export via the **Upload Excel** button in the header — that parses the workbook, persists it as the latest snapshot, and populates every view for everyone.

### Seeded accounts

`npm run db:seed` creates two accounts if they don't already exist:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `ChangeMe123!` |
| Viewer | `viewer@example.com` | `ChangeMe123!` |

**Change these passwords (or delete the accounts and create new ones) before using this anywhere but local development.** Sign in as the admin and go to the account menu → **Manage users** to create real accounts and remove the seeded ones.

### Generating a sample workbook

`scripts/make-test-workbook.mjs` builds a small workbook matching the expected sheet layout, useful for trying the app without a real export:

```bash
node scripts/make-test-workbook.mjs
# creates scripts/test-workbook.xlsx — upload it from the dashboard header
```

### Running tests

```bash
npm test
```

Covers percent-to-number conversion, principal normalization/stock-key collisions (e.g. `EABL-Nyeri` + `EABL-Nyahururu` → `eabl`), stock status thresholds (including the "No Sales Data" tier), header-row detection across layout variations, and — the single most important case in the whole time-series model — that a blank `Monthly Target` (true for every 2025 row) always resolves to `null` and is never coerced to `0` or silently summed into a partial total, whether for a single month or any multi-month period (MTD/QTD/YTD/H1/H2/Q1–Q4). Also covers period-math resolution (`resolvePeriodMonths`) for every period kind, plus an end-to-end parse of a full fixture workbook.

### Type-check & lint

```bash
npx tsc --noEmit
npm run lint
```

## Authentication & roles

- **Admin** — can upload new data, manage the Target/Product/Warehouse/Key-Account-Rep reference tables, and manage user accounts (`/admin/users`): approve or reject registration requests, change a user's role, control access to the 15 analytics pages, and reset any user's password directly.
- **Viewer** — read-only access, scoped to whichever report pages an admin has granted them (`User.allowedPages`, see `lib/pageAccess.ts`). The sidebar only shows links to pages they're allowed to see, and navigating to a disallowed URL directly shows an access-restricted message instead of the report.
- **Team Leader** — sees their own assigned team and can enter or review its weekly targets.
- **Supervisor** — sees the Team Leaders in their assigned group and can manage that group's roster and targets.

Anyone can request an account at `/register` — restricted server-side to `@pinefrost.co.ke` email addresses. New registrations start with `status: PENDING` and cannot sign in (`/login` shows "awaiting admin approval") until an admin approves them from `/admin/users`, at which point they default to all 15 analytics pages. Rejecting a request deletes it outright — there's no "rejected" limbo state. Admin-created accounts (via the "Add a new user" form on the same page) are pre-approved and skip this flow entirely.

Auth is enforced at the page/route level rather than in Proxy/Middleware (deliberately host-portable — this avoided an incompatibility when the project briefly targeted Cloudflare Workers, and there's no reason to reintroduce it now). `app/(protected)/layout.tsx` requires a signed-in session for every page under it; each API route (`/api/upload`, `/api/dataset`, `/api/snapshots`, `/api/pl/upload`, `/api/sales/upload`) checks the session itself, and admin-only routes/pages additionally require the `ADMIN` role server-side, not just hidden in the UI.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres connection strings. In production these are assembled by `docker-compose.yml` from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (the VPS's own Postgres container — see [Deploying](#deploying)), not set directly. For local dev against a Postgres you control, point both at it (no pooler required for a single-node local Postgres). |
| `AUTH_SECRET` | Secret used to sign/encrypt session JWTs — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `UPLOAD_API_KEY` | Optional. Lets a headless script call `POST /api/upload` with an `x-upload-api-key` header instead of an interactive admin session — see [Automated uploads](#automated-uploads). Leave unset to disable this auth path entirely. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_NAME` | Optional. Enables the "your account has been approved" email sent from `/admin/users`' Approve button (`lib/email.ts`). Sent (and replied-to) via `info@pinefrostdb.com`'s own SMTP. Leave `SMTP_USER`/`SMTP_PASSWORD` unset to skip sending (approvals still work, just without the email — logged as a warning). |
| `APP_URL` | Optional. The login link included in that approval email. Defaults to `https://pinefrostdb.com` when unset. |

**This project no longer uses Supabase or Netlify** (see project history #11 below) — Postgres and the app both run on the same self-hosted VPS.

## Automated uploads

`/api/upload` accepts a shared-secret header as an alternative to the interactive admin session, so a scheduled script can push a new snapshot without a browser: set `UPLOAD_API_KEY` in the environment, then send it as `x-upload-api-key` on the upload request. See `scripts/export-and-upload.ps1` for the reference implementation — it refreshes the source Power Query workbook, exports the 5 required sheets to a new `.xlsx`, and POSTs it automatically. Rotate the key by changing `UPLOAD_API_KEY` and updating the script; there's no separate revocation list since it's a single static secret.

## Data model & parsing

The `Dataset` is a set of **monthly row arrays** (one row per Year+Month+Principal[+Rep/Customer]), not a single "current state" snapshot — which period is "current" is a UI selection resolved on demand, not baked in at parse/upload time.

- `lib/types.ts` — `MonthlySalesRow`, `MonthlyCoverageRow`, `MonthlyBrandCustomerRow` (the three monthly time-series arrays), plus `WeeklyProjectionRow`/`StockItem`/`StockTotal` (unchanged) that make up the `Dataset` shape.
- `lib/parseWorkbook.ts` — the single source of truth for turning an uploaded `.xlsx`/`.xls` `ArrayBuffer` into a `Dataset`, reading 4 sheets: `All Month Sales Vs Target`, `Calls & Productivity`, `Brand&Customer Listing`, `Stock Balances`. Used identically by `/api/upload` (server persistence) and can be reused client-side for instant preview. Locates each sheet's header row by content (not a fixed row index) since monthly exports pad the rows above it inconsistently. Throws a `WorkbookParseError` with a human-readable message if a required sheet or column is missing. `Brand&Customer Listing`'s `Date` column carries a real per-day date for the current month (older months keep a 1st-of-month placeholder) — that's what drives weekly/daily sales measures (`lib/timeIntelligence.ts`'s `summarizeBrandCustomerForCurrentWeek`) now that the old `Weekly Projection` sheet (a single current-week-only snapshot) is retired.
- `lib/timeIntelligence.ts` — resolves a `PeriodSelection` (`MTD`/`MONTH`/`QTD`/`YTD`/`H1`/`H2`/`Q1`-`Q4`) into concrete months and aggregates the monthly rows over them (`summarizeSalesForPeriod`, `summarizeCoverageForPeriod`, `summarizeBrandCustomerByCustomer`/`ByRep`/`ByPrincipal`, etc.). **The one invariant that matters most**: `Monthly Target` is blank for every 2025 row and only populated from 2026 onward — if any month covered by a selected period is missing a target (or missing entirely), the period's `target` resolves to `null` for the whole period, never a partial sum masquerading as a complete one.
- `lib/normalize.ts` — the principal → brand-key normalization rule (`name.split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, '')`) used to roll up multi-region principal rows (e.g. `EABL-Nyeri`, `EABL-Nyahururu`) onto one brand across sales, coverage, brand/customer, and stock lookups alike.
- Stock items carry 4 statuses: `OK`, `Running Out`, `Out of Stock - To Order`, and `No Sales Data` (has stock on hand but no recent run-rate to compute cover days from) — tracked separately throughout (`stockNoDataCount` / `noDataCount`) rather than folded into "OK".

## API routes

All routes below require a signed-in session; `/api/upload`, `/api/pl/upload`, and `/api/sales/upload` additionally require the `ADMIN` role.

- `POST /api/upload` — accepts `multipart/form-data` with a `file` field (`.xlsx`/`.xls`, ≤25MB), parses it, validates the workbook shape, and persists it as a new snapshot (Stock/Coverage/Brand & Customer). Returns `400` on a malformed workbook, `401`/`403` if unauthorized.
- `POST /api/pl/upload` — accepts a P&L export workbook, overlaid onto `Dataset.monthlyPL` at read time (see `lib/datasetStore.ts`'s `overlayPL()`).
- `POST /api/sales/upload` — used by `scripts/db-bridge/sales-sync.ts` (the scheduled Sales sync) to push freshly-transformed Sales rows sourced from the SAP SQL bridge, rather than from the Excel workbook.
- `GET /api/integrations/ukl/sales-export` — headerless CSV export of a single day's `SalesReturnLine` rows (25 columns, matching the original hand-run report's exact order/format), pulled daily by `scripts/ukl-sales-export-pull.ps1` running on the separate server that hosts `D:\UKL_INTEGRATION\UPLOADS` for the downstream upload system. API-key-only (`x-ukl-export-key`, `UKL_SALES_EXPORT_KEY`) — replaces the manual "run report, save CSV, copy it to the server" step.
- `POST /api/sales-returns/upload` — used by `scripts/db-bridge/sales-returns/run.ts` (the scheduled `sales-returns:sync` job, wired into Task Scheduler via `scripts/sales-returns-sync.ps1`) to push Sales & Returns invoice-line detail sourced directly from the field DMS's SQL Server (CASHMEMO/DSR/POP/SKU tables — a source separate from both SAP and PinefrostAnalytics), replacing the `SalesReturnLine` table's rows for the fetched delivery-date window **and the posting batch's own `storageLocation`(s)** on each run — scoped this way (not just by date) so that multiple branches (e.g. Nairobi, Nyeri) running this same sync independently against this one shared table can never delete-and-replace each other's rows. API-key-only (`x-upload-api-key`, same `UPLOAD_API_KEY` as the other bridges) — never session-authenticated.
- `POST /api/pjp-sku-performance/upload` — a second report pushed by that same `run.ts`/schedule, reusing its connection to the same Centegy SQL Server (see `scripts/db-bridge/sales-returns/pjpSkuQuery.ts`). PJP (route) x SKU month-to-date performance — always a full-month recompute, so each run replaces that month's `PjpSkuPerformance` rows entirely rather than appending, scoped to the batch's own `distributor`(s) for the same multi-branch-safety reason as above. Same `x-upload-api-key` auth as above.
- `POST /api/outlet-sku-daily-sales/upload` — a third report from that same `run.ts`/schedule/connection (see `scripts/db-bridge/sales-returns/outletSkuNetSalesQuery.ts`). Outlet x SKU net sales (sales netted against returns) per delivery day — per-day fact grain like `/api/sales-returns/upload`, so it replaces the same delivery-date window (and the batch's own `distributor`(s)) rather than a whole month. Same `x-upload-api-key` auth.
- `POST /api/pjp-dsr-daily-activity/upload` — a fourth report from that same `run.ts`/schedule/connection (see `scripts/db-bridge/sales-returns/pjpDsrDailyActivityQuery.ts`). First/last handheld-entry time, active span, and average gap between visits per PJP/DSR/day — built from `CASHMEMO.DATE_ENTRY`, confirmed by sampling live data to be the only field in this source with real time-of-day granularity (`DELV_DATE`/`DOC_DATE` are always exactly midnight). Same per-day-window-and-distributor-scoped replacement and `x-upload-api-key` auth as above.
- `POST /api/pipeline-alerts` — per-run status email hook (success or failure, every run) for the two standalone scripts above that have no SMTP credentials of their own: `scripts/db-bridge/sales-returns/run.ts` on the Centegy machine, and `scripts/ukl-sales-export-pull.ps1` on the `D:\UKL_INTEGRATION\UPLOADS` server. Sends via `lib/email.ts`'s `sendPipelineRunEmail`, so the SMTP password stays only on the VPS. API-key-only (`x-pipeline-alert-key`, `PIPELINE_ALERT_KEY`) — never session-authenticated.
- `POST/GET /api/sales-returns/trigger` — queues (POST) or lists (GET) a manual "run the sync now" request for one Sales & Returns branch, from the `/admin/dataset` Sync Health panel's "Trigger now" button (`components/admin/TriggerSalesReturnsButton.tsx`). Session-authed, `ADMIN` only. Exists because the Centegy machines have no inbound network access at all — nothing can reach in and trigger a sync directly, so this only queues a `SalesReturnsTriggerRequest` row; see below.
- `GET /api/sales-returns/trigger/pending` — polled every few minutes by each Centegy machine's own `scripts/sales-returns-trigger-poll.ps1`, using its `-Distributor`. Claims (compare-and-swap on status) the oldest pending request for that distributor so a second poll a few minutes later can't double-claim it. API-key-only (`x-upload-api-key`, same `UPLOAD_API_KEY` as the rest of this bridge).
- `POST /api/sales-returns/trigger/complete` — called by that same poll script once it's run (or failed to run) a claimed request, to record the result. Same `x-upload-api-key` auth.
- `GET /api/dataset` — returns the latest snapshot, or a specific one via `?id=`.
- `GET /api/snapshots` — returns the last 20 upload snapshots (id, title, timestamp) for the Reports page's history table.

## Project structure

```
app/                 Next.js routes
  login/             Credentials sign-in page (public)
  register/          Self-service registration page (public, @pinefrost.co.ke only) + server action
  (protected)/       Route group requiring a session (layout.tsx enforces it)
    page.tsx         redirect("/dashboard") stub
    (analytics)/     layout.tsx: SSR dataset fetch + AnalyticsShell (Sidebar/Header/GlobalFilterBar)
      dashboard/ sales/ time-intelligence/ coverage/ reps/ customers/
      profitability/ stock/ active-outlets/ timestamps/ jp-adherence/
      order-360/ reports/ frost/ insights/  The 15 analytics pages
    admin/           Admin-only pages: users, targets, products, warehouses, key-account-reps
  api/auth/          NextAuth route handler
  api/upload|pl/upload|sales/upload|dataset|snapshots/   Data API routes (each checks its own session)
components/
  dashboard/         AnalyticsShell, Header, Sidebar (collapsible + page-visibility filtered), GlobalFilterBar, PrincipalSelector, SearchBar
  overview/          Small composed sections for /dashboard (GrowthComparison, CoverageSnapshot, TopPerformers)
  ui/                Shared KPI cards, badges, tables, gauges, animated counters, empty/loading states, Button
  charts/            Shared recharts theming
  views/             The report view components rendered by each page (Overview, Time Intelligence, Coverage, Rep Performance, Customer & Brand, Profitability, P&L Statement, Stock)
lib/
  types.ts           Dataset shape (monthly sales/coverage/brand-customer/PL arrays + stock/weekly)
  parseWorkbook.ts   Excel → Dataset parser (client + server shared)
  timeIntelligence.ts   Period resolution (MTD/QTD/YTD/H1/H2/Q1-Q4) + monthly-row aggregation + YoY/MoM helpers
  format.ts          Number/percent formatting, tier/badge/KPI-accent color helpers
  selectors.ts, trends.ts, stock.ts, insights.ts, search.ts   View-level derived-data helpers (period-aware)
  pageAccess.ts      The 15 analytics-page keys + pathname→key lookup, shared by Sidebar and AnalyticsShell for visibility gating
  store.ts           Zustand store (dataset, selected principal key, selected period, sidebar open/collapsed state)
  db.ts, datasetStore.ts   Prisma client + snapshot persistence (overlaySales/overlayTargets/overlayPL merge DB-sourced rows onto the Excel-sourced snapshot at read time)
auth.ts, types/next-auth.d.ts   Auth.js setup + session typing (no Proxy/Middleware — see Authentication & roles above)
prisma/schema.prisma  Snapshot, User (+ UserStatus/allowedPages), Target, Product, Warehouse, KeyAccountRep, PLEntry models
prisma/seed.mjs       Creates the starter admin/viewer accounts
scripts/db-bridge/    Direct SAP SQL bridge: Sales/Stock/Coverage transforms, reference-data loaders, diff-report comparisons against the Excel source
scripts/pl-bridge/    Direct SQL bridge for the P&L Statement view
scripts/sales-sync.ps1   Windows Task Scheduler wrapper for the scheduled `sales:sync` job
scripts/pl-sync.ps1   Windows Task Scheduler wrapper for the scheduled `pl:sync` job
scripts/sales-returns-sync.ps1   Windows Task Scheduler wrapper for the scheduled `sales-returns:sync` job
tests/                Vitest unit tests + fixture workbook builder
```

## Deploying

Runs on a single self-hosted Hostinger VPS via Docker Compose (`docker-compose.yml`): a Postgres 16 container, a `next build && next start` app container (a persistent Node process, not per-request serverless functions), and Caddy in front for automatic HTTPS. Postgres has no `ports:` mapping — it's reachable only inside the Compose network, never from the public internet. There is no CI/CD; the VPS's `/opt/pinefrost` is a plain file checkout (no `.git`), updated by copying the repo over and rebuilding.

**`scripts/deploy.ps1`** wraps the whole process — from a Windows machine with SSH access to the VPS (`~/.ssh/pinefrost_hostinger` by default):

```powershell
./scripts/deploy.ps1                # code only: sync files, rebuild, restart the app container
./scripts/deploy.ps1 -PushSchema     # also runs `prisma db push` against the VPS's Postgres
```

What it does, in order:

1. `git archive HEAD` — packages exactly the committed tree (no `node_modules`, `.next`, `.git`, or local `.env`) into a tarball.
2. `scp`s the tarball to the VPS and extracts it over `/opt/pinefrost`, **never touching the VPS's own `.env`** (it isn't tracked, so the archive doesn't contain it).
3. `docker compose build app` (the runner image) and `docker build --target builder -t pinefrost-builder` (a full-`node_modules` image, used only for one-off commands like schema pushes or data backfills — the runner image is pruned and doesn't have the Prisma CLI).
4. `docker compose up -d app` to recreate the app container on the new image.
5. With `-PushSchema`: runs `prisma db push` inside a throwaway `pinefrost-builder` container, on the Compose network, with `DATABASE_URL` assembled from the VPS's real `POSTGRES_*` env vars — i.e. against the actual production database, not a local one.

**Before running it for the first time**, set the VPS's SSH host/user/path at the top of the script if they differ from the defaults, and confirm `~/.ssh/pinefrost_hostinger` is the right key.

**A one-time data backfill or schema change that isn't a normal code deploy** (e.g. importing a spreadsheet directly into production) should still go through the same `pinefrost-builder` image and Compose network by hand — see the pattern `scripts/deploy.ps1` itself uses for `-PushSchema` as a template. Local scripts never have direct access to the production database; it's intentionally not exposed outside the VPS.

This project previously targeted Cloudflare Workers, then Netlify + Supabase; both are fully retired (see project history #11 below) — no config, dependencies, or env vars for either should exist anywhere in this repo.

## Project history

A chronological map of the major phases this project has gone through, for anyone (human or AI) picking this up cold — `git log` has the full commit-by-commit detail; this is the "why," grouped into phases.

1. **Initial build** — single-page dashboard, Excel-upload parsing, 7 view components switched in-place via a Zustand `view` enum, NextAuth credentials login with `ADMIN`/`VIEWER` roles.
2. **Cloudflare → Netlify + Supabase migration** — Cloudflare Workers' Edge runtime couldn't run Prisma/bcrypt/NextAuth without adapter workarounds; moved to Netlify Functions (real Node.js runtime) and Supabase Postgres. Auth is enforced at the page/layout level rather than in Proxy/Middleware specifically because of this constraint.
3. **Monthly time-series rebuild** — the `Dataset` shape changed from a single "current state" snapshot to arrays of monthly rows (`MonthlySalesRow`, `MonthlyCoverageRow`, `MonthlyBrandCustomerRow`), with `lib/timeIntelligence.ts` resolving a `PeriodSelection` into concrete months on demand. Added the automated export/upload pipeline (`scripts/export-and-upload.ps1`, `UPLOAD_API_KEY` header auth) for scheduled refreshes.
4. **Admin reference-data tooling** — `Target`, `Product`, `Warehouse`, `KeyAccountRep` Prisma models and their admin CRUD pages, plus `overlayTargets()` merging DB-sourced targets onto the Excel-sourced snapshot at read time (never baked into storage).
5. **Direct SAP/MySQL SQL bridges** — `scripts/db-bridge/` and `scripts/pl-bridge/` query the source SAP and Coverage databases directly and transform the results to match the existing `Dataset` shape, as a parallel "shadow" data source compared against the Excel-sourced numbers via `compare.ts` diff reports before being trusted. Notable bugs found and fixed this way: a Gross Profit column-name-shadowing bug in the Power Query M code (bridge was summing SAP's raw `GrssProfit` field instead of the M-code's `Gross Sales - COGS` recomputation), and a Coverage-bridge/live-DAX mismatch traced to the DAX layer's retroactive `ActivityStatus` gating (see the two project memory files linked from this repo's Claude memory index for the full investigation). Sales (Revenue/COGS/Gross Profit) was ultimately cut over to the direct bridge as the live source of truth; Stock stayed on Excel (the bridge lacks run-rate data StockView depends on). `scripts/sales-sync.ps1` and `scripts/pl-sync.ps1` wire their respective scheduled syncs into Windows Task Scheduler, offset from each other and from the Excel refresh job so none hit PINEFROSTSERVER at the same moment. One gotcha hit while wiring up `pl-sync`: a non-fatal informational `console.warn()` (unmatched Cost Centre values, included anyway) was enough to make the Task Scheduler wrapper report failure even though the sync itself succeeded — PowerShell's `$ErrorActionPreference = "Stop"` treats *any* stderr output from a native command as terminating in a non-interactive scheduled session. Fixed by using `console.log` for informational notices, reserving `console.warn`/`stderr` for things that are actually errors.
6. **Multi-page executive redesign** — converted the single-page view-switcher into 9 real routes under `app/(protected)/(analytics)/`, added a global search bar, a dedicated `/reports` page for upload/history, and rebranded to Pinefrost's corporate color system.
7. **Performance fix** — an oversized (4.68MB uncompressed) `Snapshot.data` blob was making every page load slow; gzip-compressing it in Postgres cut load time from 20-66s+ down to ~6s. Added auto-refresh-on-navigation so switching pages picks up new data without a full reload.
8. **Growth comparison + Coverage aggregation fix** — added YoY/MoM revenue growth cards (`GrowthComparison.tsx`), and fixed a real aggregation bug: Coverage counts unique outlets, so multi-month periods were being summed across months (inflating YTD/H1/quarter totals with repeat visits) instead of averaged — summing across reps within a single month is still correct, only the across-months step changed.
9. **Self-service registration & access control** — added `/register` (restricted to `@pinefrost.co.ke`), a `PENDING`/`APPROVED` approval workflow, per-viewer report-page visibility (`User.allowedPages`), and admin-driven role changes/password resets — see [Authentication & roles](#authentication--roles) above.
10. **Collapsible sidebar** — a manual collapse toggle (persisted to `localStorage`) shrinks the sidebar to a 68px icon rail, with a hover-to-peek overlay that doesn't reflow the main content.
11. **Netlify + Supabase → self-hosted VPS migration** — moved off both usage-metered platforms (Supabase's compute was undersized for the query volume several new sync jobs added; Netlify's credit-based billing was being burned fastest by exactly this app's near-universal dynamic routing) onto a single Hostinger VPS running Postgres + the app (as a persistent `next start` process, not per-request functions) + Caddy under Docker Compose — see [Deploying](#deploying). Netlify/Supabase config, dependencies, and env references have been fully removed from the repo, and the Supabase project itself has been paused. One incident this surfaced: after the migration, a local machine's `.env` kept pointing at the (still-live) old Supabase database, so a later session's schema/data changes silently landed there instead of production until the mismatch was caught by comparing what the live site actually showed against what had just been changed — the fix going forward is `scripts/deploy.ps1`'s explicit, single documented path for any prod-affecting change, rather than ad-hoc local scripts against whatever `.env` happens to be checked out.

For deeper "why" on specific non-obvious decisions (the Coverage bridge's counting semantics, the Gross Profit shadowing bug), see this project's Claude Code memory files if you're working with Claude on this repo — they're kept outside git, under `~/.claude/projects/.../memory/`, and load automatically in any session pointed at this folder.

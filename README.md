# Pinefrost Limited Performance Dashboard

A production-grade Next.js dashboard for a Kenya-based distributor to track principal (brand/supplier) sales performance — revenue vs. target, rep performance, coverage & productivity, customer/brand mix, profitability, and stock — carrying a full **monthly time series** (not just a single "current" snapshot). A global period selector lets any report be read for MTD, a specific past month, QTD, YTD, a full quarter (Q1–Q4), or a full half (H1/H2), plus YoY/MoM growth comparisons. Sales figures (Revenue/COGS/Gross Profit) are sourced live from a direct SAP SQL bridge; Stock, Coverage, and Brand & Customer data still come from a monthly Excel export. Accounts are self-service: anyone can request access at `/register`, an **admin** approves or rejects the request and controls exactly which reports each **viewer** can see.

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **NextAuth (Auth.js) v5** — credentials login, JWT sessions, `ADMIN`/`VIEWER` roles
- **Tailwind CSS v4** for the light Fluent-inspired theme, using CSS variables (`app/globals.css`) as design tokens
- **Recharts** for line/bar/doughnut/composed charts
- **SheetJS (`xlsx`)** for parsing the uploaded workbook, shared between client preview and server persistence
- **Zustand** for global client state (dataset, principal filter, active view, selected period)
- **Prisma + Supabase (Postgres)** for persisting uploaded snapshots and user accounts
- **Vitest** for parser unit tests

Deploys to **Netlify** (via `@netlify/plugin-nextjs`) — see [Deploying to Netlify](#deploying-to-netlify) below.

## Getting started

### Prerequisites

- Node.js 18.18+ (Node 20+ recommended)

### Setup

```bash
npm install
cp .env.example .env      # set DATABASE_URL, DIRECT_URL and AUTH_SECRET (see below)
npx prisma db push        # creates the Snapshot/User tables in Supabase
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

- **Admin** — can upload new data, manage the Target/Product/Warehouse/Key-Account-Rep reference tables, and manage user accounts (`/admin/users`): approve or reject registration requests, change a user's role, control exactly which of the 9 report pages a viewer can see, and reset any user's password directly.
- **Viewer** — read-only access, scoped to whichever report pages an admin has granted them (`User.allowedPages`, see `lib/pageAccess.ts`). The sidebar only shows links to pages they're allowed to see, and navigating to a disallowed URL directly shows an access-restricted message instead of the report.

Anyone can request an account at `/register` — restricted server-side to `@pinefrost.co.ke` email addresses. New registrations start with `status: PENDING` and cannot sign in (`/login` shows "awaiting admin approval") until an admin approves them from `/admin/users`, at which point they default to seeing all 9 pages. Rejecting a request deletes it outright — there's no "rejected" limbo state. Admin-created accounts (via the "Add a new user" form on the same page) are pre-approved and skip this flow entirely.

Auth is enforced at the page/route level rather than in Proxy/Middleware (deliberately host-portable — this avoided an incompatibility when the project briefly targeted Cloudflare Workers, and there's no reason to reintroduce it now). `app/(protected)/layout.tsx` requires a signed-in session for every page under it; each API route (`/api/upload`, `/api/dataset`, `/api/snapshots`, `/api/pl/upload`, `/api/sales/upload`) checks the session itself, and admin-only routes/pages additionally require the `ADMIN` role server-side, not just hidden in the UI.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection string (used by Prisma Client at runtime — pooling matters in serverless environments like Netlify Functions, which can spin up many concurrent connections). Get it from the Supabase dashboard: **Project Settings → Connect → ORMs tab → Prisma**. |
| `DIRECT_URL` | Direct (non-pooled) Postgres connection string, used only for `prisma db push`/migrations — PgBouncer's transaction pooling mode doesn't support the prepared statements migrations need. Same dashboard page as above. |
| `AUTH_SECRET` | Secret used to sign/encrypt session JWTs — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `UPLOAD_API_KEY` | Optional. Lets a headless script call `POST /api/upload` with an `x-upload-api-key` header instead of an interactive admin session — see [Automated uploads](#automated-uploads). Leave unset to disable this auth path entirely. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_NAME` | Optional. Enables the "your account has been approved" email sent from `/admin/users`' Approve button (`lib/email.ts`). Sent via a dedicated mailbox's own SMTP (defaults tuned for a Gmail account with an [App Password](https://myaccount.google.com/apppasswords)) rather than as `analytics@pinefrost.co.ke` directly, since that would require owning the `pinefrost.co.ke` domain's DNS to verify with a transactional-email provider — `Reply-To` is still set to `analytics@pinefrost.co.ke` regardless of which mailbox sends. Leave `SMTP_USER`/`SMTP_PASSWORD` unset to skip sending (approvals still work, just without the email — logged as a warning). |
| `APP_URL` | Optional. The login link included in that approval email. Defaults to `https://pinefrostdb.netlify.app` when unset. |

This project's Supabase project is `pinefrostsales` (ref `addexxjwrxmjjqmcwkib`, region `eu-west-1`), under the Pineanalytics organization.

## Automated uploads

`/api/upload` accepts a shared-secret header as an alternative to the interactive admin session, so a scheduled script can push a new snapshot without a browser: set `UPLOAD_API_KEY` in the environment, then send it as `x-upload-api-key` on the upload request. See `scripts/export-and-upload.ps1` for the reference implementation — it refreshes the source Power Query workbook, exports the 5 required sheets to a new `.xlsx`, and POSTs it automatically. Rotate the key by changing `UPLOAD_API_KEY` and updating the script; there's no separate revocation list since it's a single static secret.

## Data model & parsing

The `Dataset` is a set of **monthly row arrays** (one row per Year+Month+Principal[+Rep/Customer]), not a single "current state" snapshot — which period is "current" is a UI selection resolved on demand, not baked in at parse/upload time.

- `lib/types.ts` — `MonthlySalesRow`, `MonthlyCoverageRow`, `MonthlyBrandCustomerRow` (the three monthly time-series arrays), plus `WeeklyProjectionRow`/`StockItem`/`StockTotal` (unchanged) that make up the `Dataset` shape.
- `lib/parseWorkbook.ts` — the single source of truth for turning an uploaded `.xlsx`/`.xls` `ArrayBuffer` into a `Dataset`, reading 5 sheets: `All Month Sales Vs Target`, `Calls & Productivity`, `Brand&Customer Listing`, `Stock Balances`, `Weekly Projection`. Used identically by `/api/upload` (server persistence) and can be reused client-side for instant preview. Locates each sheet's header row by content (not a fixed row index) since monthly exports pad the rows above it inconsistently. Throws a `WorkbookParseError` with a human-readable message if a required sheet or column is missing.
- `lib/timeIntelligence.ts` — resolves a `PeriodSelection` (`MTD`/`MONTH`/`QTD`/`YTD`/`H1`/`H2`/`Q1`-`Q4`) into concrete months and aggregates the monthly rows over them (`summarizeSalesForPeriod`, `summarizeCoverageForPeriod`, `summarizeBrandCustomerByCustomer`/`ByRep`/`ByPrincipal`, etc.). **The one invariant that matters most**: `Monthly Target` is blank for every 2025 row and only populated from 2026 onward — if any month covered by a selected period is missing a target (or missing entirely), the period's `target` resolves to `null` for the whole period, never a partial sum masquerading as a complete one.
- `lib/normalize.ts` — the principal → brand-key normalization rule (`name.split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, '')`) used to roll up multi-region principal rows (e.g. `EABL-Nyeri`, `EABL-Nyahururu`) onto one brand across sales, coverage, brand/customer, and stock lookups alike.
- Stock items carry 4 statuses: `OK`, `Running Out`, `Out of Stock - To Order`, and `No Sales Data` (has stock on hand but no recent run-rate to compute cover days from) — tracked separately throughout (`stockNoDataCount` / `noDataCount`) rather than folded into "OK".

## API routes

All routes below require a signed-in session; `/api/upload`, `/api/pl/upload`, and `/api/sales/upload` additionally require the `ADMIN` role.

- `POST /api/upload` — accepts `multipart/form-data` with a `file` field (`.xlsx`/`.xls`, ≤25MB), parses it, validates the workbook shape, and persists it as a new snapshot (Stock/Coverage/Brand & Customer). Returns `400` on a malformed workbook, `401`/`403` if unauthorized.
- `POST /api/pl/upload` — accepts a P&L export workbook, overlaid onto `Dataset.monthlyPL` at read time (see `lib/datasetStore.ts`'s `overlayPL()`).
- `POST /api/sales/upload` — used by `scripts/db-bridge/sales-sync.ts` (the scheduled Sales sync) to push freshly-transformed Sales rows sourced from the SAP SQL bridge, rather than from the Excel workbook.
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
      profitability/ stock/ reports/        The 9 report pages
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
  pageAccess.ts      The 9 report-page keys + pathname→key lookup, shared by Sidebar and AnalyticsShell for visibility gating
  store.ts           Zustand store (dataset, selected principal key, selected period, sidebar open/collapsed state)
  db.ts, datasetStore.ts   Prisma client + snapshot persistence (overlaySales/overlayTargets/overlayPL merge DB-sourced rows onto the Excel-sourced snapshot at read time)
auth.ts, types/next-auth.d.ts   Auth.js setup + session typing (no Proxy/Middleware — see Authentication & roles above)
prisma/schema.prisma  Snapshot, User (+ UserStatus/allowedPages), Target, Product, Warehouse, KeyAccountRep, PLEntry models
prisma/seed.mjs       Creates the starter admin/viewer accounts
scripts/db-bridge/    Direct SAP SQL bridge: Sales/Stock/Coverage transforms, reference-data loaders, diff-report comparisons against the Excel source
scripts/pl-bridge/    Direct SQL bridge for the P&L Statement view
scripts/sales-sync.ps1   Windows Task Scheduler wrapper for the scheduled `sales:sync` job
tests/                Vitest unit tests + fixture workbook builder
```

## Deploying to Netlify

1. Push to the Git repo and connect it as a new site in Netlify (Netlify auto-detects `netlify.toml` and the `@netlify/plugin-nextjs` plugin — no extra build config needed).
2. In the Netlify site's environment variables, set `DATABASE_URL`, `DIRECT_URL`, and `AUTH_SECRET` (see [Environment variables](#environment-variables) above).
3. Netlify runs `npm install` (which runs `prisma generate` via `postinstall`) then `npm run build`.
4. Before the first deploy — or any time the schema changes — run `npx prisma db push` locally against the Supabase database (with `.env` pointing at it) to keep the schema in sync, then `npm run db:seed` once to create your first admin login.
5. Netlify Functions run on a real Node.js runtime (not a restricted edge runtime), so Prisma, bcrypt, and NextAuth all work without adapter-specific workarounds.

This project previously targeted Cloudflare Workers; that config has been removed in favor of Netlify + Supabase. Vercel would also work with no changes beyond setting the same environment variables there instead.

## Project history

A chronological map of the major phases this project has gone through, for anyone (human or AI) picking this up cold — `git log` has the full commit-by-commit detail; this is the "why," grouped into phases.

1. **Initial build** — single-page dashboard, Excel-upload parsing, 7 view components switched in-place via a Zustand `view` enum, NextAuth credentials login with `ADMIN`/`VIEWER` roles.
2. **Cloudflare → Netlify + Supabase migration** — Cloudflare Workers' Edge runtime couldn't run Prisma/bcrypt/NextAuth without adapter workarounds; moved to Netlify Functions (real Node.js runtime) and Supabase Postgres. Auth is enforced at the page/layout level rather than in Proxy/Middleware specifically because of this constraint.
3. **Monthly time-series rebuild** — the `Dataset` shape changed from a single "current state" snapshot to arrays of monthly rows (`MonthlySalesRow`, `MonthlyCoverageRow`, `MonthlyBrandCustomerRow`), with `lib/timeIntelligence.ts` resolving a `PeriodSelection` into concrete months on demand. Added the automated export/upload pipeline (`scripts/export-and-upload.ps1`, `UPLOAD_API_KEY` header auth) for scheduled refreshes.
4. **Admin reference-data tooling** — `Target`, `Product`, `Warehouse`, `KeyAccountRep` Prisma models and their admin CRUD pages, plus `overlayTargets()` merging DB-sourced targets onto the Excel-sourced snapshot at read time (never baked into storage).
5. **Direct SAP/MySQL SQL bridges** — `scripts/db-bridge/` and `scripts/pl-bridge/` query the source SAP and Coverage databases directly and transform the results to match the existing `Dataset` shape, as a parallel "shadow" data source compared against the Excel-sourced numbers via `compare.ts` diff reports before being trusted. Notable bugs found and fixed this way: a Gross Profit column-name-shadowing bug in the Power Query M code (bridge was summing SAP's raw `GrssProfit` field instead of the M-code's `Gross Sales - COGS` recomputation), and a Coverage-bridge/live-DAX mismatch traced to the DAX layer's retroactive `ActivityStatus` gating (see the two project memory files linked from this repo's Claude memory index for the full investigation). Sales (Revenue/COGS/Gross Profit) was ultimately cut over to the direct bridge as the live source of truth; Stock stayed on Excel (the bridge lacks run-rate data StockView depends on). `scripts/sales-sync.ps1` wires the scheduled sync into Windows Task Scheduler.
6. **Multi-page executive redesign** — converted the single-page view-switcher into 9 real routes under `app/(protected)/(analytics)/`, added a global search bar, a dedicated `/reports` page for upload/history, and rebranded to Pinefrost's corporate color system.
7. **Performance fix** — an oversized (4.68MB uncompressed) `Snapshot.data` blob was making every page load slow; gzip-compressing it in Postgres cut load time from 20-66s+ down to ~6s. Added auto-refresh-on-navigation so switching pages picks up new data without a full reload.
8. **Growth comparison + Coverage aggregation fix** — added YoY/MoM revenue growth cards (`GrowthComparison.tsx`), and fixed a real aggregation bug: Coverage counts unique outlets, so multi-month periods were being summed across months (inflating YTD/H1/quarter totals with repeat visits) instead of averaged — summing across reps within a single month is still correct, only the across-months step changed.
9. **Self-service registration & access control** — added `/register` (restricted to `@pinefrost.co.ke`), a `PENDING`/`APPROVED` approval workflow, per-viewer report-page visibility (`User.allowedPages`), and admin-driven role changes/password resets — see [Authentication & roles](#authentication--roles) above.
10. **Collapsible sidebar** — a manual collapse toggle (persisted to `localStorage`) shrinks the sidebar to a 68px icon rail, with a hover-to-peek overlay that doesn't reflow the main content.

For deeper "why" on specific non-obvious decisions (the Coverage bridge's counting semantics, the Gross Profit shadowing bug), see this project's Claude Code memory files if you're working with Claude on this repo — they're kept outside git, under `~/.claude/projects/.../memory/`, and load automatically in any session pointed at this folder.

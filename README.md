# Sales Performance Dashboard

A production-grade Next.js dashboard for a Kenya-based distributor to track principal (brand/supplier) sales performance — revenue vs. target, coverage, profitability, stock, and forecasts — sourced from a monthly Excel export. Includes role-based accounts: **admins** upload the monthly workbook, **viewers** get read-only access to the processed report.

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **NextAuth (Auth.js) v5** — credentials login, JWT sessions, `ADMIN`/`VIEWER` roles
- **Tailwind CSS v4** for the light Fluent-inspired theme, using CSS variables (`app/globals.css`) as design tokens
- **Recharts** for line/bar/doughnut/composed charts
- **SheetJS (`xlsx`)** for parsing the uploaded workbook, shared between client preview and server persistence
- **Zustand** for global client state (dataset, principal filter, active view)
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

Covers percent-to-number conversion, principal normalization/stock-key collisions (e.g. `EABL-Nyeri` + `EABL-Nyahururu` → `eabl`), stock status thresholds (including the "No Sales Data" tier), the Trended Revenue two-block scanning logic, and header-row detection across layout variations — plus an end-to-end parse of a full fixture workbook.

### Type-check & lint

```bash
npx tsc --noEmit
npm run lint
```

## Authentication & roles

- **Admin** — can upload a new monthly snapshot and manage user accounts (`/admin/users`).
- **Viewer** — read-only access to every dashboard view; the upload control and admin pages are not rendered for them, and the underlying API routes reject non-admin requests server-side (not just hidden in the UI).

Auth is enforced at the page/route level rather than in Proxy/Middleware (deliberately host-portable — this avoided an incompatibility when the project briefly targeted Cloudflare Workers, and there's no reason to reintroduce it now). `app/(protected)/layout.tsx` requires a signed-in session for every page under it (the dashboard and `/admin/users`); each API route (`/api/upload`, `/api/dataset`, `/api/snapshots`) checks the session itself. `/admin/users` additionally requires the `ADMIN` role, checked both by `/api/upload` and inside the page itself.

To create additional accounts, sign in as an admin and use **Manage users** in the header's account menu, or call `prisma.user.create(...)` directly (see `prisma/seed.mjs` for the exact shape — passwords are hashed with bcrypt, never stored in plain text).

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection string (used by Prisma Client at runtime — pooling matters in serverless environments like Netlify Functions, which can spin up many concurrent connections). Get it from the Supabase dashboard: **Project Settings → Connect → ORMs tab → Prisma**. |
| `DIRECT_URL` | Direct (non-pooled) Postgres connection string, used only for `prisma db push`/migrations — PgBouncer's transaction pooling mode doesn't support the prepared statements migrations need. Same dashboard page as above. |
| `AUTH_SECRET` | Secret used to sign/encrypt session JWTs — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

This project's Supabase project is `pinefrostsales` (ref `addexxjwrxmjjqmcwkib`, region `eu-west-1`), under the Pineanalytics organization.

## Data model & parsing

- `lib/types.ts` — the `Dataset` shape (principals, totals, coverage, trended revenue, weekly projection, stock) that the rest of the app depends on.
- `lib/parseWorkbook.ts` — the single source of truth for turning an uploaded `.xlsx`/`.xls` `ArrayBuffer` into a `Dataset`. Used identically by `/api/upload` (server persistence) and can be reused client-side for instant preview. Locates each sheet's header row by content (not a fixed row index) since monthly exports pad the rows above it inconsistently. Throws a `WorkbookParseError` with a human-readable message if a required sheet or column is missing.
- `lib/normalize.ts` — the principal → stock-key normalization rule (`name.split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, '')`) used to roll up multi-region principal rows (e.g. `EABL-Nyeri`, `EABL-Nyahururu`) onto one brand for stock and trended-revenue lookups.
- Stock items carry 4 statuses: `OK`, `Running Out`, `Out of Stock - To Order`, and `No Sales Data` (has stock on hand but no recent run-rate to compute cover days from) — tracked separately throughout (`stockNoDataCount` / `noDataCount`) rather than folded into "OK".

## API routes

All routes below require a signed-in session; `/api/upload` additionally requires the `ADMIN` role.

- `POST /api/upload` — accepts `multipart/form-data` with a `file` field (`.xlsx`/`.xls`, ≤25MB), parses it, validates the workbook shape, and persists it as a new snapshot. Returns `400` on a malformed workbook, `401`/`403` if unauthorized.
- `GET /api/dataset` — returns the latest snapshot, or a specific one via `?id=`.
- `GET /api/snapshots` — returns the last 20 upload snapshots (id, title, timestamp) for the header's history switcher.

## Project structure

```
app/                 Next.js routes
  login/             Credentials sign-in page (public)
  (protected)/       Route group requiring a session (layout.tsx enforces it)
    page.tsx         Dashboard
    admin/users/     Admin-only user management page + server actions
  api/auth/          NextAuth route handler
  api/upload|dataset|snapshots/   Dashboard data API routes (each checks its own session)
components/
  dashboard/         Header, Sidebar, DashboardShell (view switching + principal filter)
  ui/                Shared KPI cards, badges, tables, gauges, animated counters, empty/loading states
  charts/            Shared recharts theming
  views/             The 7 dashboard views (Overview, YTD, Trends, Coverage, Profitability, Stock, H1)
lib/
  types.ts           Dataset shape
  parseWorkbook.ts   Excel → Dataset parser (client + server shared)
  format.ts          Number/percent formatting, tier/badge/KPI-accent color helpers
  selectors.ts, trends.ts, stock.ts, insights.ts   View-level derived-data helpers
  store.ts           Zustand store
  db.ts, datasetStore.ts   Prisma client + snapshot persistence
auth.ts, types/next-auth.d.ts   Auth.js setup + session typing (no Proxy/Middleware — see Authentication & roles above)
prisma/schema.prisma  Snapshot + User models
prisma/seed.mjs       Creates the starter admin/viewer accounts
tests/                Vitest unit tests + fixture workbook builder
```

## Deploying to Netlify

1. Push to the Git repo and connect it as a new site in Netlify (Netlify auto-detects `netlify.toml` and the `@netlify/plugin-nextjs` plugin — no extra build config needed).
2. In the Netlify site's environment variables, set `DATABASE_URL`, `DIRECT_URL`, and `AUTH_SECRET` (see [Environment variables](#environment-variables) above).
3. Netlify runs `npm install` (which runs `prisma generate` via `postinstall`) then `npm run build`.
4. Before the first deploy — or any time the schema changes — run `npx prisma db push` locally against the Supabase database (with `.env` pointing at it) to keep the schema in sync, then `npm run db:seed` once to create your first admin login.
5. Netlify Functions run on a real Node.js runtime (not a restricted edge runtime), so Prisma, bcrypt, and NextAuth all work without adapter-specific workarounds.

This project previously targeted Cloudflare Workers; that config has been removed in favor of Netlify + Supabase. Vercel would also work with no changes beyond setting the same environment variables there instead.

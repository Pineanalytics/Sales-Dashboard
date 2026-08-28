// Sales & Returns bridge — THREE reports against the same Centegy SQL Server
// connection (separate source from both SAP's SQLBRIDGE_SQL_* and
// PinefrostAnalytics' EABL_CALL_SQL_*): the field DMS's CASHMEMO/DSR/POP/SKU
// tables.
//   1. Invoice-line detail (query.ts) — per-day fact table, delete-and-replace
//      by delivery-date window. Original purpose of this bridge.
//   2. PJP x SKU month-to-date performance (pjpSkuQuery.ts) — always covers
//      the whole current month through this run's own window-end; see that
//      file's header comment.
//   3. Outlet x SKU net daily sales (outletSkuNetSalesQuery.ts) — sales
//      netted against returns, per delivery day. Per-day fact grain like #1,
//      so it reuses the same [start, end] window/delete-and-replace scheme.
// #2 and #3 were added later, piggybacking on this same run/connection
// rather than separate scheduled tasks ("live along the sales_return
// instance", per user request) since they query the same database. Any
// further reports against this source should follow the same pattern: a new
// query file + a new fetch/post pair added to main() below, sharing this one
// connection.
//
// Wired into Windows Task Scheduler via scripts/sales-returns-sync.ps1 as
// THREE separate daily runs (each replaces only its own delivery-date window,
// so overlapping runs are safe and idempotent — see app/api/sales-returns/upload):
//   - 20:00 -Window Today     same-day, necessarily partial (day isn't over yet)
//   - 07:00 -Window Yesterday finalizes yesterday once the DMS day is fully closed
//   - 12:00 -Window Catchup   yesterday+today, catches anything the other two missed
// SALES_RETURNS_WINDOW selects which of the three; defaults to "yesterday" for
// any ad-hoc/manual run. SALES_RETURNS_BACKFILL_FROM=YYYY-MM-DD overrides all of
// the above for a one-off historical repair (from that date through yesterday) —
// never set it for a routine scheduled run.
process.loadEnvFile();

import sql from "mssql";
import { fetchSalesReturnLines } from "./query";
import { fetchPjpSkuPerformance } from "./pjpSkuQuery";
import { fetchOutletSkuDailySales } from "./outletSkuNetSalesQuery";

const APP_URL = process.env.SALES_RETURNS_APP_URL || "https://pinefrostdb.com";
const CHUNK_SIZE = 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Nairobi has no DST — fixed UTC+3.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the Sales & Returns SQL Server read-only connection.`);
  return value;
}

function nairobiMidnight(daysAgo: number): Date {
  const now = new Date(Date.now() + NAIROBI_OFFSET_MS);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  return day;
}

/** First day of the given date's month (Africa/Nairobi) — the start bound for
 *  the PJP x SKU month-to-date report, which always covers the whole current
 *  month up to `date` rather than a single day. */
function nairobiMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function dateWindow(): { start: Date; end: Date } {
  const backfillFrom = process.env.SALES_RETURNS_BACKFILL_FROM;
  if (backfillFrom) {
    const start = new Date(`${backfillFrom}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new Error("SALES_RETURNS_BACKFILL_FROM must be YYYY-MM-DD.");
    return { start, end: nairobiMidnight(1) };
  }

  const window = (process.env.SALES_RETURNS_WINDOW ?? "yesterday").toLowerCase();
  const today = nairobiMidnight(0);
  const yesterday = nairobiMidnight(1);
  if (window === "today") return { start: today, end: today };
  if (window === "catchup") return { start: yesterday, end: today };
  if (window === "yesterday") return { start: yesterday, end: yesterday };
  throw new Error(`SALES_RETURNS_WINDOW must be "today", "yesterday", or "catchup" (got "${window}").`);
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": required("UPLOAD_API_KEY") },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
}

/** Reports this run's outcome to app/api/pipeline-alerts so it goes out as an
 *  email — never throws, so a mail-sending hiccup can't turn a good sync run
 *  into a failed one (or mask a real failure). PIPELINE_ALERT_KEY is optional:
 *  unset (e.g. before it's been provisioned on this machine) just skips it. */
async function reportRun(status: "success" | "failure", summary: string) {
  const key = process.env.PIPELINE_ALERT_KEY;
  if (!key) {
    console.warn("[sales-returns] Pipeline alert email skipped: PIPELINE_ALERT_KEY is not set.");
    return;
  }
  try {
    const response = await fetch(`${APP_URL}/api/pipeline-alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pipeline-alert-key": key },
      body: JSON.stringify({
        task: `sales-returns-sync (${process.env.SALES_RETURNS_WINDOW ?? "yesterday"})`,
        machine: process.env.COMPUTERNAME,
        status,
        summary,
      }),
    });
    if (!response.ok) console.warn(`[sales-returns] Pipeline alert email failed: ${response.status} ${await response.text()}`);
  } catch (error) {
    console.warn("[sales-returns] Could not send pipeline alert email:", error);
  }
}

async function main() {
  const { start, end } = dateWindow();
  console.log(`[sales-returns] Fetching Sales & Returns lines for delivery date ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}...`);

  // A named instance (e.g. Data Source=.\sndpro) resolves its TCP port
  // dynamically via the SQL Server Browser service (UDP 1434) rather than a
  // fixed port — tedious/mssql handles that via options.instanceName, and
  // port must be left unset when it's used.
  const instanceName = process.env.SALES_RETURNS_SQL_INSTANCE || undefined;
  const pool = await new sql.ConnectionPool({
    server: required("SALES_RETURNS_SQL_SERVER"),
    ...(instanceName ? {} : { port: Number(process.env.SALES_RETURNS_SQL_PORT ?? 1433) }),
    database: required("SALES_RETURNS_SQL_DATABASE"),
    user: required("SALES_RETURNS_SQL_USER"),
    password: required("SALES_RETURNS_SQL_PASSWORD"),
    connectionTimeout: 30_000,
    requestTimeout: 10 * 60_000,
    options: {
      encrypt: (process.env.SALES_RETURNS_SQL_ENCRYPT ?? "false") === "true",
      trustServerCertificate: (process.env.SALES_RETURNS_SQL_TRUST_SERVER_CERT ?? "true") === "true",
      ...(instanceName ? { instanceName } : {}),
    },
  }).connect();

  try {
    const lines = await fetchSalesReturnLines(pool, start, end);
    console.log(`[sales-returns] Fetched ${lines.length} invoice-line rows.`);

    const windowStart = start.toISOString();
    // Window end is exclusive on the upload side, so cover the full end day.
    const windowEnd = new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString();

    for (let index = 0; index < lines.length; index += CHUNK_SIZE) {
      await post("/api/sales-returns/upload", {
        lines: lines.slice(index, index + CHUNK_SIZE),
        windowStart: index === 0 ? windowStart : undefined,
        windowEnd: index === 0 ? windowEnd : undefined,
      });
    }
    // Nothing to delete-and-replace when the source returned zero rows for the window —
    // still worth telling the app the window was checked, so re-run manually if that's wrong.
    if (lines.length === 0) await post("/api/sales-returns/upload", { lines: [], windowStart, windowEnd });

    // Second report, same connection: PJP x SKU month-to-date performance.
    // Always the whole current month through this run's own window-end, not
    // just [start, end] — see pjpSkuQuery.ts's header comment.
    const monthStart = nairobiMonthStart(end);
    const pjpSkuRows = await fetchPjpSkuPerformance(pool, monthStart, end);
    console.log(`[sales-returns] Fetched ${pjpSkuRows.length} PJP x SKU performance rows for ${monthStart.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}.`);
    await post("/api/pjp-sku-performance/upload", { rows: pjpSkuRows, month: monthStart.toISOString() });

    // Third report, same connection: Outlet x SKU net daily sales. Per-day
    // fact grain like the invoice-line detail above, so it reuses this same
    // [start, end] window/delete-and-replace scheme rather than the PJP x
    // SKU report's month-wide one.
    const outletSkuRows = await fetchOutletSkuDailySales(pool, start, end);
    console.log(`[sales-returns] Fetched ${outletSkuRows.length} Outlet x SKU daily sales rows for ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}.`);
    await post("/api/outlet-sku-daily-sales/upload", { rows: outletSkuRows, windowStart, windowEnd });

    const summary =
      `Uploaded ${lines.length} rows for ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}. ` +
      `PJP x SKU: replaced ${pjpSkuRows.length} rows for month ${monthStart.toISOString().slice(0, 10)}. ` +
      `Outlet x SKU: replaced ${outletSkuRows.length} rows for the same window.`;
    console.log(`[sales-returns] ${summary}`);
    return summary;
  } finally {
    await pool.close();
  }
}

// Chained (not fire-and-forget) so the pipeline-alert POST's outstanding
// request keeps the process alive until it settles, same as the rest of main().
main()
  .then((summary) => reportRun("success", summary))
  .catch(async (error) => {
    console.error("[sales-returns] FAILED:", error);
    await reportRun("failure", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

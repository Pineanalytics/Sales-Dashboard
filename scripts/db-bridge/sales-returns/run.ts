// Sales & Returns invoice-line bridge. Separate SQL Server source from both
// SAP (SQLBRIDGE_SQL_*) and PinefrostAnalytics (EABL_CALL_SQL_*) — the field
// DMS's CASHMEMO/DSR/POP/SKU tables (see query.ts's header comment). Wire this
// into Windows Task Scheduler via scripts/sales-returns-sync.ps1, once daily
// (the source report is a day-grain delivery-date extract, not a live feed).
//
// Default: fetches yesterday (Africa/Nairobi, no DST) — CM.DELV_DATE needs the
// day fully closed out on the DMS side before the report is stable. Set
// SALES_RETURNS_BACKFILL_FROM=YYYY-MM-DD to instead fetch from that date
// through yesterday inclusive, for a one-off historical repair; never set it
// for the routine scheduled run.
process.loadEnvFile();

import sql from "mssql";
import { fetchSalesReturnLines } from "./query";

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

function dateWindow(): { start: Date; end: Date } {
  const yesterday = nairobiMidnight(1);
  const backfillFrom = process.env.SALES_RETURNS_BACKFILL_FROM;
  if (!backfillFrom) return { start: yesterday, end: yesterday };
  const start = new Date(`${backfillFrom}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("SALES_RETURNS_BACKFILL_FROM must be YYYY-MM-DD.");
  return { start, end: yesterday };
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": required("UPLOAD_API_KEY") },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
}

async function main() {
  const { start, end } = dateWindow();
  console.log(`[sales-returns] Fetching Sales & Returns lines for delivery date ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}...`);

  const pool = await new sql.ConnectionPool({
    server: required("SALES_RETURNS_SQL_SERVER"),
    port: Number(process.env.SALES_RETURNS_SQL_PORT ?? 1433),
    database: required("SALES_RETURNS_SQL_DATABASE"),
    user: required("SALES_RETURNS_SQL_USER"),
    password: required("SALES_RETURNS_SQL_PASSWORD"),
    connectionTimeout: 30_000,
    requestTimeout: 10 * 60_000,
    options: {
      encrypt: (process.env.SALES_RETURNS_SQL_ENCRYPT ?? "false") === "true",
      trustServerCertificate: (process.env.SALES_RETURNS_SQL_TRUST_SERVER_CERT ?? "true") === "true",
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

    console.log(`[sales-returns] Uploaded ${lines.length} rows for ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}.`);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("[sales-returns] FAILED:", error);
  process.exitCode = 1;
});

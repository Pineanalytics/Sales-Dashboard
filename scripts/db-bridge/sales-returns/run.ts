// Sales & Returns bridge — four Centegy reports sharing one SQL connection.
// Routine Task Scheduler runs use SALES_RETURNS_WINDOW=smart: every five
// minutes the bridge finds SQL's newest real (non-future) delivery date,
// compares a bounded set of exact daily signatures with the VPS, repairs the
// oldest mismatch, verifies it, and only then records a successful heartbeat.
// Manual today/yesterday/catchup/backfill windows remain available.
process.loadEnvFile();

import sql from "mssql";
import {
  fetchLatestSalesReturnDate,
  fetchSalesReturnDailySignatures,
  fetchSalesReturnLines,
} from "./query";
import { fetchPjpSkuPerformance } from "./pjpSkuQuery";
import { fetchOutletSkuDailySales } from "./outletSkuNetSalesQuery";
import { fetchPjpDsrDailyActivity } from "./pjpDsrDailyActivityQuery";
import {
  selectOldestMismatch,
  resolveManualSalesReturnsWindow,
  signaturesMatch,
  type SalesReturnsDailySignature,
} from "../../../lib/salesReturnsReconciliation";

const APP_URL = process.env.SALES_RETURNS_APP_URL || "https://pinefrostdb.com";
const CHUNK_SIZE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_RECONCILE_DAYS = 62;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the Sales & Returns SQL Server read-only connection.`);
  return value;
}

function nairobiMidnight(daysAgo: number): Date {
  const now = new Date(Date.now() + NAIROBI_OFFSET_MS);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nairobiMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEndAtLatest(date: Date, latestSourceDate: Date): Date {
  const calendarMonthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return calendarMonthEnd < latestSourceDate ? calendarMonthEnd : latestSourceDate;
}

function configuredReconcileDays(): number {
  const parsed = Number(process.env.SALES_RETURNS_RECONCILE_DAYS ?? 35);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > MAX_RECONCILE_DAYS) {
    throw new Error(`SALES_RETURNS_RECONCILE_DAYS must be an integer from 2 to ${MAX_RECONCILE_DAYS}.`);
  }
  return parsed;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-upload-api-key": required("UPLOAD_API_KEY"),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function post(path: string, body: unknown): Promise<void> {
  await requestJson(path, { method: "POST", body: JSON.stringify(body) });
}

async function targetSignatures(distributor: string, from: Date, to: Date): Promise<SalesReturnsDailySignature[]> {
  const query = new URLSearchParams({ distributor, from: dateOnly(from), to: dateOnly(to) });
  const result = await requestJson<{ days: SalesReturnsDailySignature[] }>(`/api/sales-returns/reconciliation?${query}`);
  return result.days;
}

async function recordHeartbeat(distributor: string, latestSourceDate: Date): Promise<void> {
  await post("/api/sales-returns/reconciliation", { distributor, latestSourceDate: dateOnly(latestSourceDate) });
}

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
        task: `sales-returns-sync (${process.env.SALES_RETURNS_WINDOW ?? "smart"})`,
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

async function uploadWindow(
  pool: sql.ConnectionPool,
  start: Date,
  end: Date,
  distributor: string,
  latestSourceDate: Date,
  snapshotDate: Date = start
): Promise<string> {
  console.log(`[sales-returns] Extracting delivery date ${dateOnly(start)} to ${dateOnly(end)}...`);
  const lines = await fetchSalesReturnLines(pool, start, end, distributor);
  console.log(`[sales-returns] Fetched ${lines.length} invoice-line rows.`);

  const windowStart = start.toISOString();
  const windowEnd = new Date(end.getTime() + DAY_MS).toISOString();

  // Rebuild the snapshot for the repaired day's month. A previous-month
  // repair uses that month's final day; a current-month repair uses SQL's
  // current latest delivery date, never the older repair day.
  const pjpMonth = nairobiMonthStart(snapshotDate);
  const pjpEnd = monthEndAtLatest(snapshotDate, latestSourceDate);
  const pjpSkuRows = await fetchPjpSkuPerformance(pool, pjpMonth, pjpEnd, distributor);
  console.log(`[sales-returns] Fetched ${pjpSkuRows.length} PJP x SKU rows for ${dateOnly(pjpMonth)} to ${dateOnly(pjpEnd)}.`);
  await post("/api/pjp-sku-performance/upload", { rows: pjpSkuRows, month: pjpMonth.toISOString(), distributor });

  const outletSkuRows = await fetchOutletSkuDailySales(pool, start, end, distributor);
  console.log(`[sales-returns] Fetched ${outletSkuRows.length} Outlet x SKU daily rows.`);
  await post("/api/outlet-sku-daily-sales/upload", { rows: outletSkuRows, distributor, windowStart, windowEnd });

  const activityRows = await fetchPjpDsrDailyActivity(pool, start, end, distributor);
  console.log(`[sales-returns] Fetched ${activityRows.length} PJP/DSR daily activity rows.`);
  await post("/api/pjp-dsr-daily-activity/upload", { rows: activityRows, distributor, windowStart, windowEnd });

  // Invoice lines are the reconciliation commit marker and therefore upload
  // last. If any companion report above fails, their source/VPS mismatch is
  // retried next cycle instead of a completed invoice signature masking it.
  for (let index = 0; index < lines.length; index += CHUNK_SIZE) {
    await post("/api/sales-returns/upload", {
      lines: lines.slice(index, index + CHUNK_SIZE),
      distributor,
      windowStart: index === 0 ? windowStart : undefined,
      windowEnd: index === 0 ? windowEnd : undefined,
    });
  }
  if (lines.length === 0) {
    await post("/api/sales-returns/upload", { lines: [], distributor, windowStart, windowEnd });
  }

  return `Uploaded ${lines.length} invoice lines, ${pjpSkuRows.length} PJP x SKU rows, ` +
    `${outletSkuRows.length} Outlet x SKU rows, and ${activityRows.length} activity rows for ${dateOnly(start)}.`;
}

async function runSmart(pool: sql.ConnectionPool, distributor: string): Promise<string> {
  const latestSourceDate = await fetchLatestSalesReturnDate(pool, distributor, nairobiMidnight(0));
  if (!latestSourceDate) throw new Error(`No non-future Sales & Returns transactions found for distributor ${distributor}.`);

  const reconcileDays = configuredReconcileDays();
  const from = new Date(latestSourceDate.getTime() - (reconcileDays - 1) * DAY_MS);
  console.log(`[sales-returns] SQL latest delivery date is ${dateOnly(latestSourceDate)}; reconciling ${dateOnly(from)} to ${dateOnly(latestSourceDate)}.`);

  const [source, target] = await Promise.all([
    fetchSalesReturnDailySignatures(pool, from, latestSourceDate, distributor),
    targetSignatures(distributor, from, latestSourceDate),
  ]);
  const mismatch = selectOldestMismatch(source, target);

  if (!mismatch) {
    await recordHeartbeat(distributor, latestSourceDate);
    const summary = `No VPS gaps or changed SQL days across ${source.length} populated day(s); latest is ${dateOnly(latestSourceDate)}.`;
    console.log(`[sales-returns] ${summary}`);
    return summary;
  }

  const repairDate = new Date(`${mismatch.date}T00:00:00.000Z`);
  console.log(`[sales-returns] Repairing oldest mismatch ${mismatch.date}: SQL ${mismatch.source.rowCount} rows / VPS ${mismatch.target.rowCount} rows.`);
  const uploadSummary = await uploadWindow(pool, repairDate, repairDate, distributor, latestSourceDate);

  const verifiedRows = await targetSignatures(distributor, repairDate, repairDate);
  const verified = verifiedRows[0] ?? {
    ...mismatch.source,
    rowCount: 0,
    invoiceCount: 0,
    saleQtyPieces: 0,
    freeQtyPieces: 0,
    grossSale: 0,
    netSale: 0,
    totalDiscount: 0,
  };
  if (!signaturesMatch(mismatch.source, verified)) {
    throw new Error(`Post-upload verification failed for ${mismatch.date}: SQL ${JSON.stringify(mismatch.source)}, VPS ${JSON.stringify(verified)}.`);
  }

  await recordHeartbeat(distributor, latestSourceDate);
  const summary = `${uploadSummary} Verification passed; older gaps remain prioritized on the next five-minute run.`;
  console.log(`[sales-returns] ${summary}`);
  return summary;
}

async function main() {
  const distributor = required("SALES_RETURNS_DISTRIBUTOR");
  if (!/^\d+$/.test(distributor)) throw new Error("SALES_RETURNS_DISTRIBUTOR must be numeric.");
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
    const mode = (process.env.SALES_RETURNS_WINDOW ?? "smart").toLowerCase();
    if (mode === "smart" && !process.env.SALES_RETURNS_BACKFILL_FROM) return await runSmart(pool, distributor);

    const { start, end } = resolveManualSalesReturnsWindow(
      mode,
      process.env.SALES_RETURNS_BACKFILL_FROM
    );
    const latestSourceDate = (await fetchLatestSalesReturnDate(pool, distributor, nairobiMidnight(0))) ?? end;
    const summary = await uploadWindow(pool, start, end, distributor, latestSourceDate, end);
    // Catchup/today/yesterday runs successfully upload every report but used
    // to omit this marker. That made a healthy branch look stale whenever a
    // backfill guard was active or a quiet source produced no changed rows.
    await recordHeartbeat(distributor, latestSourceDate);
    return summary;
  } finally {
    await pool.close();
  }
}

main().catch(async (error) => {
  console.error("[sales-returns] FAILED:", error);
  await reportRun("failure", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

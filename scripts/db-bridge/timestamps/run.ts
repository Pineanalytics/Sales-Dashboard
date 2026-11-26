// Dedicated live Timestamps bridge. This intentionally does not share the
// hourly Active Outlets worker: field managers need fresh first-call data,
// while the Active Outlets YTD ledger is much more expensive to refresh.
//
// Every five-minute pass rebuilds a small rolling two-day window. The extra
// completed day absorbs delayed/corrected Pine writes without repeatedly
// scanning the current month. Dimensions are fetched only for IDs referenced
// in that window, avoiding the previous 77k-outlet read on every live pass.
//
// Run with: npm run timestamps:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import {
  fetchFactLines,
  fetchNoSaleVisits,
  fetchOutletsByIds,
  fetchProductsByIds,
  fetchUsersByIds,
  resolveNoSalesColumns,
} from "../active-outlets/query";
import { buildRepCalls, collapseToPurchaseEvents, countCallLines } from "../active-outlets/transform";
import { loadPrincipals } from "../reference/loadFromDb";
import { fetchVisitLog, firstVisits } from "./visitLog";
import { TIMESTAMPS_RETENTION_MONTHS } from "../../../lib/timeManagement";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "timestamps";
const ROLLING_WINDOW_DAYS = 2;
// The direct server worker reaches Next.js without the public proxy's request
// buffering. Timestamp records are wider than sales/event records, so keep its
// payload deliberately small enough for Node's route-body limit. The desktop
// fallback retains the existing 2,000-row batch unless explicitly overridden.
const BATCH_SIZE = Number(process.env.TIMESTAMPS_BATCH_SIZE ?? "2000");

function nairobiCalendarDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .filter((part) => part.type !== "literal");
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  // This is a UTC midnight *date marker*, deliberately matching RepCall.date's
  // normalized storage convention rather than the Nairobi-midnight instant.
  return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
}

function currentMonthStart(now: Date): Date {
  const day = nairobiCalendarDay(now);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

// How far back RepCall is allowed to keep rows. Kept wider than the current
// month (unlike the rolling fetch window below) so the Timestamps page's
// Month selector has more than the current month to offer.
function retentionStart(now: Date): Date {
  const day = nairobiCalendarDay(now);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - (TIMESTAMPS_RETENTION_MONTHS - 1), 1));
}

function rollingWindow(now: Date): { start: Date; end: Date; nextDay: Date } {
  const todayStart = nairobiCalendarDay(now);
  const lookbackStart = new Date(todayStart.getTime() - (ROLLING_WINDOW_DAYS - 1) * 86400000);
  const start = new Date(Math.max(currentMonthStart(now).getTime(), lookbackStart.getTime()));
  return { start, end: now, nextDay: new Date(todayStart.getTime() + 86400000) };
}

/** A deliberate one-time replay can rebuild historical compressed visits from
 * Pine's line-level data, including quantities in cases.  The normal scheduled
 * run remains restricted to its inexpensive two-day window. */
function syncWindow(now: Date): { start: Date; end: Date; nextDay: Date; isBackfill: boolean } {
  const from = process.env.TIMESTAMPS_BACKFILL_FROM;
  if (!from) return { ...rollingWindow(now), isBackfill: false };

  const start = new Date(`${from}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("TIMESTAMPS_BACKFILL_FROM must be YYYY-MM-DD.");
  const until = process.env.TIMESTAMPS_BACKFILL_TO;
  const end = until ? new Date(`${until}T23:59:59.999Z`) : now;
  if (Number.isNaN(end.getTime()) || end < start) throw new Error("TIMESTAMPS_BACKFILL_TO must be YYYY-MM-DD on or after TIMESTAMPS_BACKFILL_FROM.");
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return { start, end, nextDay: new Date(endDay.getTime() + 86400000), isBackfill: true };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
}

async function postJson(appUrl: string, apiKey: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

async function uploadCallsBatched(
  appUrl: string,
  apiKey: string,
  callRows: ReturnType<typeof buildRepCalls>,
  windowStart: Date,
  retainFrom: Date
): Promise<boolean> {
  const batches = chunk(callRows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", {
      calls: batch,
      windowStart: i === 0 ? windowStart.toISOString() : undefined,
      retainFrom: i === 0 ? retainFrom.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[timestamps] Upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[timestamps] Upload: ${total}/${callRows.length} call rows saved across ${batches.length} batch(es).`);
  return ok;
}

async function setSyncState(appUrl: string, apiKey: string, completedAt: Date): Promise<void> {
  const result = await postJson(appUrl, apiKey, "/api/active-outlets/sync-state", {
    bridge: BRIDGE_NAME,
    lastIncrementalAt: completedAt.toISOString(),
  });
  if (!result.ok) throw new Error(`Failed to update sync state: ${result.status} ${JSON.stringify(result.body)}`);
}

/** TIMESTAMPS_LINES_ONLY=1 with TIMESTAMPS_BACKFILL_FROM: reads Pine's sale and order lines a week at a time and fills only the
 *  product-line count on calls already saved. Unlike a plain backfill it replaces no rows and moves no watermark. */
async function backfillLineCounts(config: ReturnType<typeof loadCoverageConfigFromEnv>, apiKey: string, appUrl: string, start: Date, end: Date) {
  const WINDOW_MS = 7 * 86400000;
  let sent = 0;
  let updated = 0;
  for (let from = start; from < end; from = new Date(from.getTime() + WINDOW_MS)) {
    const to = new Date(Math.min(from.getTime() + WINDOW_MS, end.getTime()));
    const factLines = await withCoverageConnection(config, (conn) => fetchFactLines(conn, from, to));
    const counts = countCallLines(factLines);
    for (const batch of chunk(counts, BATCH_SIZE)) {
      if (batch.length === 0) continue;
      const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", { lineCounts: batch });
      if (!result.ok) throw new Error(`Line-count upload failed: ${result.status} ${JSON.stringify(result.body)}`);
      sent += batch.length;
      updated += Number((result.body as { updated?: number }).updated ?? 0);
    }
    console.log(`[timestamps] Lines ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}: ${factLines.length} source lines, ${counts.length} calls with products.`);
  }
  console.log(`[timestamps] Line counts done: ${sent} sent, ${updated} saved calls updated.`);
}

/** The Nairobi day of an instant, as the visit log writes it. */
const nairobiDay = (value: Date) => nairobiCalendarDay(value).toISOString().slice(0, 10);

/** TIMESTAMPS_STARTS_ONLY=1 with TIMESTAMPS_BACKFILL_FROM: moves the start of each saved rep-day back to the rep's first logged
 *  visit where that is earlier. Replaces no rows, changes no call, and moves no watermark. */
async function backfillDayStarts(config: ReturnType<typeof loadCoverageConfigFromEnv>, apiKey: string, appUrl: string, startDay: string, endDay: string) {
  const log = await withCoverageConnection(config, (conn) => fetchVisitLog(conn, startDay, endDay));
  const dayStarts = [...firstVisits(log)].map(([key, time]) => {
    const [date, employeeCode] = key.split("|");
    return { date, employeeCode, firstVisit: time.toISOString() };
  });
  console.log(`[timestamps] Visit log ${startDay} to ${endDay}: ${log.length} rows, ${dayStarts.length} rep-days with a visit.`);
  let updated = 0;
  for (const batch of chunk(dayStarts, BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", { dayStarts: batch });
    if (!result.ok) throw new Error(`Day-start upload failed: ${result.status} ${JSON.stringify(result.body)}`);
    updated += Number((result.body as { updated?: number }).updated ?? 0);
  }
  console.log(`[timestamps] Day starts done: ${dayStarts.length} sent, ${updated} saved calls moved to an earlier start.`);
}

async function main() {
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) throw new Error("TIMESTAMPS_BATCH_SIZE must be a positive integer.");
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env (same value configured on the VPS).");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const now = new Date();
  const { start, end, nextDay, isBackfill } = syncWindow(now);

  if (process.env.TIMESTAMPS_STARTS_ONLY === "1") {
    if (!isBackfill) throw new Error("TIMESTAMPS_STARTS_ONLY needs TIMESTAMPS_BACKFILL_FROM=YYYY-MM-DD.");
    await backfillDayStarts(config, apiKey, appUrl, start.toISOString().slice(0, 10), nextDay.toISOString().slice(0, 10));
    return;
  }

  if (process.env.TIMESTAMPS_LINES_ONLY === "1") {
    if (!isBackfill) throw new Error("TIMESTAMPS_LINES_ONLY needs TIMESTAMPS_BACKFILL_FROM=YYYY-MM-DD.");
    await backfillLineCounts(config, apiKey, appUrl, start, end);
    return;
  }

  console.log(`[timestamps] Connecting to ${config.host}/${config.database} (${isBackfill ? "backfill" : `rolling ${ROLLING_WINDOW_DAYS}-day`} window ${start.toISOString()} - ${end.toISOString()})...`);
  const { factLines, noSaleColumns, noSaleVisits, visitLog, outlets, users, products } = await withCoverageConnection(config, async (conn) => {
    const factLines = await fetchFactLines(conn, start, end);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, start, nextDay) : [];
    // When the day started. Without the log the calls are still right, so a failure here doesn't stop the sync.
    const visitLog = await fetchVisitLog(conn, nairobiDay(start), nextDay.toISOString().slice(0, 10)).catch((error: Error) => {
      console.log("[timestamps] Could not read the visit log; days start at the first sale, order or no-sale.", error.message);
      return [];
    });

    const outletIds = [...factLines.map((row) => row.customerId), ...noSaleVisits.map((row) => row.customerId)];
    const userIds = [...factLines.map((row) => row.userId), ...noSaleVisits.map((row) => row.userId)];
    const productIds = factLines.map((row) => row.itemId);
    const [outlets, users, products] = await Promise.all([
      fetchOutletsByIds(conn, outletIds),
      fetchUsersByIds(conn, userIds),
      fetchProductsByIds(conn, productIds),
    ]);
    return { factLines, noSaleColumns, noSaleVisits, visitLog, outlets, users, products };
  });

  console.log(`[timestamps] Fetched ${factLines.length} sale/order lines and ${noSaleVisits.length} no-sale visits.`);
  console.log(`[timestamps] Compact dimensions: ${outlets.length} outlets, ${users.length} users, ${products.length} products.`);
  if (!noSaleColumns) {
    console.log("[timestamps] NOTE: pine.nosales columns could not be auto-detected - unproductive calls are not included this run.");
  }

  // The timestamp bridge normally runs on the Pine-connected workstation,
  // where the production dashboard database is intentionally not reachable
  // directly. Cost-centre enrichment is useful but not needed to build rep
  // visits or calculate cases, so do not let that optional lookup block the
  // live sync/backfill.
  let principalsData: Awaited<ReturnType<typeof loadPrincipals>> = [];
  try {
    principalsData = await loadPrincipals();
  } catch (error) {
    // This bridge normally runs on a machine that cannot reach the dashboard
    // database. Keep this non-fatal condition on stdout: PowerShell Task
    // Scheduler treats native-process stderr as an error record and otherwise
    // aborts the wrapper before the calls can be uploaded.
    console.log("[timestamps] Could not load principal enrichment; continuing without cost-centre labels.", (error as Error).message);
  }
  const { events, unmatchedSkuCount } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const callRows = buildRepCalls(events, noSaleVisits, outlets, users, firstVisits(visitLog));
  console.log(`[timestamps] Collapsed to ${events.length} purchase events and built ${callRows.length} call rows.`);
  if (unmatchedSkuCount > 0) {
    console.log(`[timestamps] NOTE: ${unmatchedSkuCount} purchase/SKU lines had no resolvable Cost Centre but remain productive calls.`);
  }

  const uploaded = await uploadCallsBatched(appUrl, apiKey, callRows, start, retentionStart(now));
  if (!uploaded) {
    process.exitCode = 1;
    console.log("[timestamps] Skipping watermark update because the upload failed - the next run will rebuild the same window.");
    return;
  }

  await setSyncState(appUrl, apiKey, now);
  console.log("[timestamps] Sync watermark updated.");
}

main().catch((err) => {
  console.error("[timestamps] FAILED:", err);
  process.exitCode = 1;
});

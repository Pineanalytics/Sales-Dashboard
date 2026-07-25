// Entry point for the live Active Outlets + Timestamps sync. Self-schedules
// full vs incremental mode via a persisted SyncWatermark (see
// app/api/active-outlets/sync-state) instead of always re-fetching the
// entire YTD from Pine's MySQL — Task Scheduler still fires this hourly, but
// most runs now only fetch a small "since last sync" window:
//
//   FULL mode (forced once every ~22h, or if no watermark exists yet):
//     exactly today's old behavior — full YTD fetch, full recompute for
//     every outlet (including outlets with zero new events this cycle, so
//     the Inactive staleness sweep and Monthly Trend rebuild both see
//     everyone), RepCall replaced for the whole current month.
//   INCREMENTAL mode: fetches only fact lines since the last watermark
//     (minus a 3h overlap buffer, guarding against Pine write-latency/clock
//     skew — safe because ActiveOutletEvent inserts are idempotent), and
//     rebuilds RepCall for only the last 2 days (earlier-in-the-month rows
//     are left untouched). Active Outlets Monthly Trend is NOT touched on
//     incremental runs — it's a monthly-granularity metric, correctly
//     recomputed once a day during the full pass rather than needing the
//     whole month's events on every hourly run.
//
// Run with: npm run active-outlets:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchNoSaleVisits, fetchOutlets, fetchProducts, fetchUsers, resolveNoSalesColumns } from "./query";
import { buildActiveOutletEvents, buildActiveOutletsMonthly, buildRepCalls, collapseToPurchaseEvents, type ActiveOutletEventRow } from "./transform";
import principalsData from "../reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "active-outlets";
// Forces a full resync at least once a day without any time-of-day logic —
// whichever hourly run first crosses this age wins, drifting by a few
// minutes run-to-run, which is fine for a safety net (see file header).
const FULL_RESYNC_AFTER_HOURS = 22;
const OVERLAP_BUFFER_HOURS = 3;
const REPCALL_INCREMENTAL_DAYS = 2;
// A single request carrying tens of thousands of rows trips request
// payload/timeout limits before the server side ever gets to chunk its own DB
// writes (the same class of problem export-and-upload.ps1 documents for its
// Brand&Customer sheet) — batch the HTTP requests themselves, client-side.
const BATCH_SIZE = 2000;

interface SyncState {
  lastIncrementalAt: string | null;
  lastFullResyncAt: string | null;
}

function currentMonthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start, end };
}

async function postJson(appUrl: string, apiKey: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
}

async function getSyncState(appUrl: string, apiKey: string): Promise<SyncState> {
  const response = await fetch(`${appUrl}/api/active-outlets/sync-state?bridge=${BRIDGE_NAME}`, {
    headers: { "x-upload-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Failed to read sync state: ${response.status} ${await response.text()}`);
  return response.json();
}

async function setSyncState(appUrl: string, apiKey: string, body: { lastIncrementalAt: string; lastFullResyncAt?: string }): Promise<void> {
  const response = await postJson(appUrl, apiKey, "/api/active-outlets/sync-state", { bridge: BRIDGE_NAME, ...body });
  if (!response.ok) throw new Error(`Failed to update sync state: ${response.status} ${JSON.stringify(response.body)}`);
}

/** Uploads ActiveOutletEvent ledger rows in batches; each batch's insert is
 *  ON CONFLICT DO NOTHING (idempotent) and immediately derives/upserts
 *  ActiveOutlet summaries for just the (year, principal, customerId) keys
 *  that batch touched. Monthly rows (full mode only) and the finalize sweep
 *  (full mode only, after all event batches) piggyback on this same route. */
async function uploadEventsBatched(
  appUrl: string,
  apiKey: string,
  eventRows: ActiveOutletEventRow[],
  monthlyRows: ReturnType<typeof buildActiveOutletsMonthly>,
  year: string,
  calendarMonthsElapsed: number,
  isFullMode: boolean
): Promise<boolean> {
  const batches = chunk(eventRows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", {
      events: batch,
      monthly: isFullMode && i === 0 ? monthlyRows : [],
      year,
      calendarMonthsElapsed,
    });
    if (!result.ok) {
      console.error(`[active-outlets] Active Outlets upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[active-outlets] Active Outlets Event upload: ${total}/${eventRows.length} ledger rows saved across ${batches.length} batch(es).`);

  if (ok && isFullMode) {
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", {
      finalizeFullResync: true,
      year,
      calendarMonthsElapsed,
    });
    if (!result.ok) {
      console.error("[active-outlets] Full-resync finalize (summary sweep + Inactive flip) FAILED:", result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      console.log("[active-outlets] Full-resync finalize: summary re-derived and Inactive sweep applied for every outlet.");
    }
  }
  return ok;
}

/** Uploads Timestamps in batches, scoped to windowStart..now — the server
 *  deletes RepCall rows from windowStart onward once (first batch only)
 *  before reinserting, leaving earlier-in-the-month rows untouched on an
 *  incremental run. */
async function uploadCallsBatched(appUrl: string, apiKey: string, callRows: ReturnType<typeof buildRepCalls>, windowStart: Date): Promise<boolean> {
  const batches = chunk(callRows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", {
      calls: batch,
      windowStart: i === 0 ? windowStart.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[active-outlets] Timestamps upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[active-outlets] Timestamps upload: ${total}/${callRows.length} call rows saved across ${batches.length} batch(es).`);
  return ok;
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured on the VPS).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const calendarMonthsElapsed = now.getUTCMonth() + 1;
  const { start: monthStart, end: monthEnd } = currentMonthWindow(now);

  const syncState = await getSyncState(appUrl, apiKey);
  const hoursSinceFullResync = syncState.lastFullResyncAt ? (now.getTime() - new Date(syncState.lastFullResyncAt).getTime()) / 3600000 : Infinity;
  const isFullMode = hoursSinceFullResync >= FULL_RESYNC_AFTER_HOURS;

  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const fetchStart = isFullMode
    ? ytdStart
    : new Date(Math.max(ytdStart.getTime(), (syncState.lastIncrementalAt ? new Date(syncState.lastIncrementalAt).getTime() : ytdStart.getTime()) - OVERLAP_BUFFER_HOURS * 3600000));

  const repCallWindowStart = isFullMode ? monthStart : new Date(Math.max(monthStart.getTime(), now.getTime() - REPCALL_INCREMENTAL_DAYS * 86400000));

  console.log(
    `[active-outlets] Mode: ${isFullMode ? "FULL" : "INCREMENTAL"}. Connecting to ${config.host}/${config.database} (fetch ${fetchStart.toISOString()} - ${now.toISOString()})...`
  );

  const { outlets, users, products, factLines, noSaleColumns, noSaleVisits } = await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, factLines] = await Promise.all([
      fetchOutlets(conn),
      fetchUsers(conn),
      fetchProducts(conn),
      fetchFactLines(conn, fetchStart, now),
    ]);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, repCallWindowStart, monthEnd) : [];
    return { outlets, users, products, factLines, noSaleColumns, noSaleVisits };
  });

  console.log(`[active-outlets] Dimensions: ${outlets.length} outlets, ${users.length} users, ${products.length} products.`);
  console.log(`[active-outlets] Fetched ${factLines.length} sale/order lines.`);
  if (!noSaleColumns) {
    console.log("[active-outlets] NOTE: pine.nosales columns could not be auto-detected — unproductive calls will not be reported this run.");
  } else {
    console.log(`[active-outlets] Fetched ${noSaleVisits.length} no-sale visits.`);
  }

  const { events, unmatchedSkuCount } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const distinctOutletsTouched = new Set(events.map((e) => e.customerId)).size;
  console.log(`[active-outlets] Collapsed to ${events.length} purchase events; ${distinctOutletsTouched} distinct outlets touched this run.`);
  if (unmatchedSkuCount > 0) {
    console.log(`[active-outlets] NOTE: ${unmatchedSkuCount} purchase/SKU lines had no resolvable Cost Centre — still counted as calls/productive calls, just excluded from Active Outlets' per-Cost-Centre figures.`);
  }

  const eventRows = buildActiveOutletEvents(events, outlets, users);
  const monthlyRows = isFullMode ? buildActiveOutletsMonthly(events) : [];
  console.log(`[active-outlets] Built ${eventRows.length} ledger event rows${isFullMode ? `, ${monthlyRows.length} monthly trend rows` : ""}.`);

  const repCallEvents = events.filter((e) => e.purchaseTime >= repCallWindowStart && e.purchaseTime <= monthEnd);
  const callRows = buildRepCalls(repCallEvents, noSaleVisits, outlets, users);
  console.log(`[active-outlets] Built ${callRows.length} Timestamps (call) rows for ${isFullMode ? "the current month" : `the last ${REPCALL_INCREMENTAL_DAYS} days`}.`);

  const eventsOk = await uploadEventsBatched(appUrl, apiKey, eventRows, monthlyRows, year, calendarMonthsElapsed, isFullMode);
  if (!eventsOk) process.exitCode = 1;

  const callsOk = await uploadCallsBatched(appUrl, apiKey, callRows, repCallWindowStart);
  if (!callsOk) process.exitCode = 1;

  if (eventsOk && callsOk) {
    const newestEventTime = events.reduce((max, e) => (e.purchaseTime > max ? e.purchaseTime : max), fetchStart);
    await setSyncState(appUrl, apiKey, {
      lastIncrementalAt: newestEventTime.toISOString(),
      lastFullResyncAt: isFullMode ? now.toISOString() : undefined,
    });
    console.log(`[active-outlets] Sync watermark updated (${isFullMode ? "full" : "incremental"} mode).`);
  } else {
    console.log("[active-outlets] Skipping watermark update since one or more uploads failed — next run will retry the same window.");
  }
}

main().catch((err) => {
  console.error("[active-outlets] FAILED:", err);
  process.exitCode = 1;
});

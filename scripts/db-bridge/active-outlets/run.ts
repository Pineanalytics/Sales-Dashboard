// Entry point for the hourly Active Outlets sync. Timestamps intentionally
// run separately every five minutes in scripts/db-bridge/timestamps/run.ts,
// keeping operational call visibility independent of this much heavier
// YTD outlet ledger and monthly-trend rebuild.
//
// FULL mode (forced at least every ~22h, or when no watermark exists): fetches
// YTD activity, rebuilds the Active Outlets monthly trend, and sweeps inactive
// outlets. INCREMENTAL mode fetches only activity since the saved watermark
// minus a short overlap buffer. Ledger inserts are idempotent, so overlap is
// safe and protects against Pine write latency and clock skew.
//
// Run with: npm run active-outlets:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchOutlets, fetchProducts, fetchUsers } from "./query";
import { buildActiveOutletEvents, buildActiveOutletsMonthly, collapseToPurchaseEvents, type ActiveOutletEventRow } from "./transform";
import { loadPrincipals } from "../reference/loadFromDb";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "active-outlets";
const FULL_RESYNC_AFTER_HOURS = 22;
const OVERLAP_BUFFER_HOURS = 3;
const BATCH_SIZE = 2000;

interface SyncState {
  lastIncrementalAt: string | null;
  lastFullResyncAt: string | null;
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

/** Uploads ActiveOutletEvent ledger rows in batches. The server derives the
 * affected outlet summaries from each batch and finalizes the all-outlet
 * inactive sweep only after a successful full pass. */
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
      console.error(`[active-outlets] Upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[active-outlets] Event upload: ${total}/${eventRows.length} ledger rows saved across ${batches.length} batch(es).`);

  if (ok && isFullMode) {
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", {
      finalizeFullResync: true,
      year,
      calendarMonthsElapsed,
    });
    if (!result.ok) {
      console.error("[active-outlets] Full-resync finalize FAILED:", result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      console.log("[active-outlets] Full-resync finalize: summary re-derived and Inactive sweep applied for every outlet.");
    }
  }
  return ok;
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env (same value configured on the VPS).");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const calendarMonthsElapsed = now.getUTCMonth() + 1;
  const syncState = await getSyncState(appUrl, apiKey);
  const hoursSinceFullResync = syncState.lastFullResyncAt ? (now.getTime() - new Date(syncState.lastFullResyncAt).getTime()) / 3600000 : Infinity;
  const isFullMode = hoursSinceFullResync >= FULL_RESYNC_AFTER_HOURS;

  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const fetchStart = isFullMode
    ? ytdStart
    : new Date(Math.max(ytdStart.getTime(), (syncState.lastIncrementalAt ? new Date(syncState.lastIncrementalAt).getTime() : ytdStart.getTime()) - OVERLAP_BUFFER_HOURS * 3600000));

  console.log(`[active-outlets] Mode: ${isFullMode ? "FULL" : "INCREMENTAL"}. Connecting to ${config.host}/${config.database} (fetch ${fetchStart.toISOString()} - ${now.toISOString()})...`);

  const { outlets, users, products, factLines } = await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, factLines] = await Promise.all([
      fetchOutlets(conn),
      fetchUsers(conn),
      fetchProducts(conn),
      fetchFactLines(conn, fetchStart, now),
    ]);
    return { outlets, users, products, factLines };
  });

  console.log(`[active-outlets] Dimensions: ${outlets.length} outlets, ${users.length} users, ${products.length} products.`);
  console.log(`[active-outlets] Fetched ${factLines.length} sale/order lines.`);
  const principalsData = await loadPrincipals();
  const { events, unmatchedSkuCount } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const distinctOutletsTouched = new Set(events.map((e) => e.customerId)).size;
  console.log(`[active-outlets] Collapsed to ${events.length} purchase events; ${distinctOutletsTouched} distinct outlets touched this run.`);
  if (unmatchedSkuCount > 0) {
    console.log(`[active-outlets] NOTE: ${unmatchedSkuCount} purchase/SKU lines had no resolvable Cost Centre - still counted as calls/productive calls, just excluded from Active Outlets' per-Cost-Centre figures.`);
  }

  const eventRows = buildActiveOutletEvents(events, outlets, users);
  const monthlyRows = isFullMode ? buildActiveOutletsMonthly(events) : [];
  console.log(`[active-outlets] Built ${eventRows.length} ledger event rows${isFullMode ? `, ${monthlyRows.length} monthly trend rows` : ""}.`);

  const eventsOk = await uploadEventsBatched(appUrl, apiKey, eventRows, monthlyRows, year, calendarMonthsElapsed, isFullMode);
  if (!eventsOk) {
    process.exitCode = 1;
    console.log("[active-outlets] Skipping watermark update since the upload failed - next run will retry the same window.");
    return;
  }

  const newestEventTime = events.reduce((max, e) => (e.purchaseTime > max ? e.purchaseTime : max), fetchStart);
  await setSyncState(appUrl, apiKey, {
    lastIncrementalAt: newestEventTime.toISOString(),
    lastFullResyncAt: isFullMode ? now.toISOString() : undefined,
  });
  console.log(`[active-outlets] Sync watermark updated (${isFullMode ? "full" : "incremental"} mode).`);
}

main().catch((err) => {
  console.error("[active-outlets] FAILED:", err);
  process.exitCode = 1;
});

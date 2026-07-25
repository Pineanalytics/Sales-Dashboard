// Entry point for the live JP Adherence sync (Journey Plan / JP Adherence
// Report / Monthly Split). Self-schedules full vs incremental mode via a
// persisted SyncWatermark (reusing Phase 1's Active Outlets table/route,
// bridge: "jp-adherence") instead of always regenerating the route from a
// full 90-day fetch — Task Scheduler still fires this twice daily
// (08:00/19:00), but only one run a week now does the expensive part:
//
//   FULL mode (forced once every ~7 days, or if no watermark exists yet):
//     exactly today's old behavior — 90-day fetch, buildRepOutletVisits +
//     geoSweepHomeDays + buildJourneyPlan regenerate the route (a rep's
//     actual visit pattern only drifts over weeks, not days — see
//     LOOKBACK_DAYS's own comment below), buildJpAdherence for the trimmed
//     recent window, buildMonthlySplit (full, ~600 rows, monthly-grain).
//   INCREMENTAL mode (both daily runs, default): skips route regeneration
//     entirely. Only fetches actual sale/order/no-sale activity for the
//     last 2 days, reads back the already-stored plan for that same window
//     via GET /api/jp-adherence/plan, and runs the existing buildJpAdherence
//     matching unchanged. JourneyPlanRow and JPMonthlySplitRow are left
//     untouched — the route doesn't need to change day to day, and Monthly
//     Split is monthly-granularity output that doesn't need twice-daily
//     freshness (same reasoning Phase 1 applied to Active Outlets Monthly
//     Trend).
//
// Run with: npm run jp-adherence:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchNoSaleVisits, fetchOutlets, fetchProducts, fetchUsers, resolveNoSalesColumns } from "./query";
import {
  aggregateActualVisits,
  buildJourneyPlan,
  buildJpAdherence,
  buildMonthlySplit,
  buildRepOutletVisits,
  collapseToPurchaseEvents,
  resolveRepCostCentreGroups,
  type JourneyPlanRow,
} from "./transform";
import principalsData from "../reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "jp-adherence";
// Forces a full route-regeneration pass at least once a week — a rep's
// actual visit pattern drifts over weeks, not days (see the original
// LOOKBACK_DAYS comment this replaces), so twice-daily regeneration was
// always more than the data itself needed.
const FULL_RESYNC_AFTER_HOURS = 24 * 7;
// Route derivation needs enough history to stabilize (round(visitDays/weeks)
// is noisy under ~2 weeks) but shouldn't reach back to January by Q4 — full
// mode only.
const LOOKBACK_DAYS = 90;
// Journey Plan and JP Adherence Detail are one row per rep x outlet x DAY —
// over the full 862-rep field force this gets huge fast (discovered on the
// first live run: uploads timed out purely from row/request count). Only a
// recent window is ever persisted — full mode's own upload trim.
const RECENT_UPLOAD_DAYS = 7;
// Incremental mode's actual-activity fetch window — mirrors Phase 1's
// RepCall precedent (a day that's already closed doesn't need re-fetching).
const INCREMENTAL_DAYS = 2;
const BATCH_SIZE = 2000;

interface SyncState {
  lastIncrementalAt: string | null;
  lastFullResyncAt: string | null;
}

function lookbackWindow(now: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86400000);
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

// Reuses Phase 1's generic (bridge-agnostic, despite the URL) sync-state
// route rather than adding a near-duplicate under jp-adherence/ — it already
// takes an arbitrary "bridge" key.
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

async function fetchStoredPlan(appUrl: string, apiKey: string, from: Date, to: Date): Promise<JourneyPlanRow[]> {
  const url = `${appUrl}/api/jp-adherence/plan?from=${from.toISOString()}&to=${to.toISOString()}`;
  const response = await fetch(url, { headers: { "x-upload-api-key": apiKey } });
  if (!response.ok) throw new Error(`Failed to read stored plan: ${response.status} ${await response.text()}`);
  const { rows } = (await response.json()) as { rows: (Omit<JourneyPlanRow, "date"> & { date: string })[] };
  return rows.map((r) => ({ ...r, date: new Date(r.date) }));
}

async function uploadBatched(
  appUrl: string,
  apiKey: string,
  label: string,
  path: string,
  rows: unknown[],
  buildBody: (batch: unknown[], isFirst: boolean) => unknown
): Promise<boolean> {
  const batches = chunk(rows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, path, buildBody(batch, i === 0));
    if (!result.ok) {
      console.error(`[jp-adherence] ${label} upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[jp-adherence] ${label} upload: ${total}/${rows.length} rows saved across ${batches.length} batch(es).`);
  return ok;
}

async function runFullMode(config: ReturnType<typeof loadCoverageConfigFromEnv>, appUrl: string, apiKey: string, now: Date): Promise<{ ok: boolean; newestEventTime: Date }> {
  const { start, end } = lookbackWindow(now);
  console.log(`[jp-adherence] Mode: FULL. Connecting to ${config.host}/${config.database} (${LOOKBACK_DAYS}-day lookback ${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})...`);

  const { outlets, users, products, factLines, noSaleColumns, noSaleVisits } = await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, factLines] = await Promise.all([fetchOutlets(conn), fetchUsers(conn), fetchProducts(conn), fetchFactLines(conn, start, end)]);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, start, end) : [];
    return { outlets, users, products, factLines, noSaleColumns, noSaleVisits };
  });

  console.log(`[jp-adherence] Dimensions: ${outlets.length} outlets, ${users.length} users, ${products.length} products.`);
  console.log(`[jp-adherence] Fetched ${factLines.length} sale/order lines.`);
  if (!noSaleColumns) {
    console.log("[jp-adherence] NOTE: pine.nosales columns could not be auto-detected — unproductive visits will not be reported this run.");
  } else {
    console.log(`[jp-adherence] Fetched ${noSaleVisits.length} no-sale visits.`);
  }

  const { events, unmatchedSkuCount } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  console.log(`[jp-adherence] Collapsed to ${events.length} purchase events.`);
  if (unmatchedSkuCount > 0) {
    console.log(`[jp-adherence] NOTE: ${unmatchedSkuCount} purchase/SKU lines had no resolvable Cost Centre — still counted as visits, just excluded from route/Monthly-Split per-Cost-Centre figures.`);
  }

  const visits = buildRepOutletVisits(events, outlets, users, start, end);
  const groupedVisits = resolveRepCostCentreGroups(visits);
  console.log(`[jp-adherence] Derived ${visits.length} rep-outlet visit-frequency rows.`);

  const journeyPlan = buildJourneyPlan(groupedVisits, start, end);
  console.log(`[jp-adherence] Built ${journeyPlan.length} Journey Plan rows.`);

  const actualVisits = aggregateActualVisits(events, noSaleVisits, outlets, users);
  const { detail: adherenceDetail, summary: adherenceDaily } = buildJpAdherence(journeyPlan, actualVisits);
  console.log(`[jp-adherence] Built ${adherenceDaily.length} JP Adherence daily summary rows, ${adherenceDetail.length} detail rows.`);

  const monthlySplit = buildMonthlySplit(events, noSaleVisits, users, end);
  console.log(`[jp-adherence] Built ${monthlySplit.length} Monthly Split rows.`);

  const recentCutoff = new Date(end.getTime() - RECENT_UPLOAD_DAYS * 86400000);
  const journeyPlanRecent = journeyPlan.filter((r) => r.date >= recentCutoff);
  const adherenceDetailRecent = adherenceDetail.filter((r) => r.date >= recentCutoff);
  console.log(
    `[jp-adherence] Trimming to the most recent ${RECENT_UPLOAD_DAYS} days for upload: ${journeyPlanRecent.length}/${journeyPlan.length} Journey Plan rows, ${adherenceDetailRecent.length}/${adherenceDetail.length} detail rows.`
  );

  let ok = true;

  const planOk = await uploadBatched(appUrl, apiKey, "Journey Plan", "/api/jp-adherence/upload/plan", journeyPlanRecent, (batch, isFirst) => ({
    rows: batch,
    windowStart: isFirst ? recentCutoff.toISOString() : undefined,
  }));
  if (!planOk) ok = false;

  const detailBatches = chunk(adherenceDetailRecent, BATCH_SIZE);
  let adherenceOk = true;
  let detailTotal = 0;
  for (const [i, batch] of detailBatches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/jp-adherence/upload/adherence", {
      detail: batch,
      daily: i === 0 ? adherenceDaily : [],
      windowStart: i === 0 ? recentCutoff.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[jp-adherence] JP Adherence upload batch ${i + 1}/${detailBatches.length} FAILED:`, result.status, JSON.stringify(result.body));
      adherenceOk = false;
    } else {
      detailTotal += batch.length;
    }
  }
  console.log(`[jp-adherence] JP Adherence upload: ${detailTotal}/${adherenceDetailRecent.length} detail rows + ${adherenceDaily.length} daily rows saved across ${detailBatches.length} batch(es).`);
  if (!adherenceOk) ok = false;

  const splitOk = await uploadBatched(appUrl, apiKey, "Monthly Split", "/api/jp-adherence/upload/monthly-split", monthlySplit, (batch, isFirst) => ({ rows: batch, replace: isFirst }));
  if (!splitOk) ok = false;

  const newestEventTime = events.reduce((max, e) => (e.purchaseTime > max ? e.purchaseTime : max), start);
  return { ok, newestEventTime };
}

async function runIncrementalMode(
  config: ReturnType<typeof loadCoverageConfigFromEnv>,
  appUrl: string,
  apiKey: string,
  now: Date
): Promise<{ ok: boolean; newestEventTime: Date }> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const start = new Date(end.getTime() - INCREMENTAL_DAYS * 86400000);
  console.log(`[jp-adherence] Mode: INCREMENTAL. Connecting to ${config.host}/${config.database} (${INCREMENTAL_DAYS}-day window ${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})...`);

  const { outlets, users, products, factLines, noSaleColumns, noSaleVisits } = await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, factLines] = await Promise.all([fetchOutlets(conn), fetchUsers(conn), fetchProducts(conn), fetchFactLines(conn, start, end)]);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, start, end) : [];
    return { outlets, users, products, factLines, noSaleColumns, noSaleVisits };
  });

  console.log(`[jp-adherence] Fetched ${factLines.length} sale/order lines, ${noSaleVisits.length} no-sale visits.`);

  const { events } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const actualVisits = aggregateActualVisits(events, noSaleVisits, outlets, users);
  console.log(`[jp-adherence] Collapsed to ${events.length} purchase events, ${actualVisits.length} actual-visit rows.`);

  const storedPlan = await fetchStoredPlan(appUrl, apiKey, start, end);
  console.log(`[jp-adherence] Read back ${storedPlan.length} already-stored Journey Plan rows for this window.`);

  const { detail: adherenceDetail, summary: adherenceDaily } = buildJpAdherence(storedPlan, actualVisits);
  console.log(`[jp-adherence] Built ${adherenceDaily.length} JP Adherence daily summary rows, ${adherenceDetail.length} detail rows.`);

  let ok = true;
  const detailBatches = chunk(adherenceDetail, BATCH_SIZE);
  let detailTotal = 0;
  for (const [i, batch] of detailBatches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/jp-adherence/upload/adherence", {
      detail: batch,
      daily: i === 0 ? adherenceDaily : [],
      windowStart: i === 0 ? start.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[jp-adherence] JP Adherence upload batch ${i + 1}/${detailBatches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      detailTotal += batch.length;
    }
  }
  console.log(`[jp-adherence] JP Adherence upload: ${detailTotal}/${adherenceDetail.length} detail rows + ${adherenceDaily.length} daily rows saved across ${detailBatches.length} batch(es).`);

  const newestEventTime = events.reduce((max, e) => (e.purchaseTime > max ? e.purchaseTime : max), start);
  return { ok, newestEventTime };
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured on the VPS).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const now = new Date();

  const syncState = await getSyncState(appUrl, apiKey);
  const hoursSinceFullResync = syncState.lastFullResyncAt ? (now.getTime() - new Date(syncState.lastFullResyncAt).getTime()) / 3600000 : Infinity;
  const isFullMode = hoursSinceFullResync >= FULL_RESYNC_AFTER_HOURS;

  const { ok, newestEventTime } = isFullMode ? await runFullMode(config, appUrl, apiKey, now) : await runIncrementalMode(config, appUrl, apiKey, now);
  if (!ok) process.exitCode = 1;

  // Recomputes Contribution-by-Rep + Daily Projection from what this sync just
  // wrote — needs TeamLeaderAssignment/WeeklyTarget, which live in this app's own
  // Postgres DB, so the computation itself runs inside the app (see
  // lib/repContribution.ts), triggered here as a signal rather than a data POST.
  // Runs every sync, both modes — it's a Postgres-only recompute, not a Pine
  // re-fetch, so it isn't part of the cost this change targets.
  if (ok) {
    const result = await postJson(appUrl, apiKey, "/api/jp-adherence/recompute-derived", {});
    if (!result.ok) {
      console.error("[jp-adherence] Contribution-by-Rep/Daily Projection recompute FAILED:", result.status, JSON.stringify(result.body));
      process.exitCode = 1;
    } else {
      console.log(`[jp-adherence] Recomputed derived Target data: ${JSON.stringify(result.body)}`);
    }
  }

  if (ok) {
    await setSyncState(appUrl, apiKey, {
      lastIncrementalAt: newestEventTime.toISOString(),
      lastFullResyncAt: isFullMode ? now.toISOString() : undefined,
    });
    console.log(`[jp-adherence] Sync watermark updated (${isFullMode ? "full" : "incremental"} mode).`);
  } else {
    console.log("[jp-adherence] Skipping watermark update since one or more uploads failed — next run will retry.");
  }
}

main().catch((err) => {
  console.error("[jp-adherence] FAILED:", err);
  process.exitCode = 1;
});

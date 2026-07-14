// Entry point for the live JP Adherence sync (Journey Plan / JP Adherence
// Report / Monthly Split). Fetches a trailing 90-day window of fact lines
// from the "pine" field-force MySQL DB, derives a route (geo-sweep +
// historical visit frequency) per rep, generates a Journey Plan for every
// calendar month in that window, compares it against actual sale/order/
// no-sale activity over the same window, and builds the Monthly Split
// rollup. POSTs to three upload routes; a failure in one doesn't block the
// others. Run with: npm run jp-adherence:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchNoSaleVisits, fetchOutlets, fetchProducts, fetchUsers, resolveNoSalesColumns } from "./query";
import { aggregateActualVisits, buildJourneyPlan, buildJpAdherence, buildMonthlySplit, buildRepOutletVisits, collapseToPurchaseEvents, resolveRepCostCentreGroups } from "./transform";
import principalsData from "../reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";
// Route derivation needs enough history to stabilize (round(visitDays/weeks)
// is noisy under ~2 weeks) but shouldn't reach back to January by Q4 (a
// rep's real route drifts) — see the session's implementation plan for the
// full justification. Trivially tunable if the field-force's cadence turns
// out to need a longer/shorter window.
const LOOKBACK_DAYS = 90;
// Same Netlify request-payload/timeout lesson as active-outlets/run.ts —
// batch the HTTP requests themselves, client-side, not just the DB writes.
const BATCH_SIZE = 2000;
// Journey Plan and JP Adherence Detail are one row per rep x outlet x DAY —
// over the full 862-rep field force and a 90-day window that's 800K+ and 1M+
// rows respectively (discovered on the first live run: the upload timed out
// against Netlify well before hitting any payload-size ceiling, purely from
// sheer row/request count — nothing else in this dashboard is remotely this
// large). The 90-day window is still needed in full to derive accurate
// visit-frequency/route and to compute JP Adherence Daily + Monthly Split
// correctly (both stay full-window, and both are small: ~10K and ~600 rows).
// Only the raw per-visit Plan/Detail rows are trimmed down to a recent
// window before upload — this is exactly what the page needs day-to-day
// (nobody browses a specific outlet's planned route from 11 weeks ago), same
// "keep only what's actually useful to show" scoping Timestamps already
// applies to RepCall (current-month-only vs the YTD-scoped bridges).
const RECENT_UPLOAD_DAYS = 7;

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

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in Netlify).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const { start, end } = lookbackWindow(now);

  console.log(`[jp-adherence] Connecting to ${config.host}/${config.database} (${LOOKBACK_DAYS}-day lookback ${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})...`);

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

  // Only the recent window of raw per-visit rows gets persisted — see the
  // RECENT_UPLOAD_DAYS comment above. adherenceDaily/monthlySplit are already
  // small and stay full-window.
  const recentCutoff = new Date(end.getTime() - RECENT_UPLOAD_DAYS * 86400000);
  const journeyPlanRecent = journeyPlan.filter((r) => r.date >= recentCutoff);
  const adherenceDetailRecent = adherenceDetail.filter((r) => r.date >= recentCutoff);
  console.log(
    `[jp-adherence] Trimming to the most recent ${RECENT_UPLOAD_DAYS} days for upload: ${journeyPlanRecent.length}/${journeyPlan.length} Journey Plan rows, ${adherenceDetailRecent.length}/${adherenceDetail.length} detail rows.`
  );

  const planOk = await uploadBatched(appUrl, apiKey, "Journey Plan", "/api/jp-adherence/upload/plan", journeyPlanRecent, (batch, isFirst) => ({ rows: batch, replace: isFirst }));
  if (!planOk) process.exitCode = 1;

  // Daily is far smaller than Detail — piggyback it on Detail's first batch only,
  // rather than adding a second top-level batching loop for it.
  const detailBatches = chunk(adherenceDetailRecent, BATCH_SIZE);
  let adherenceOk = true;
  let detailTotal = 0;
  for (const [i, batch] of detailBatches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/jp-adherence/upload/adherence", {
      detail: batch,
      daily: i === 0 ? adherenceDaily : [],
      replace: i === 0,
    });
    if (!result.ok) {
      console.error(`[jp-adherence] JP Adherence upload batch ${i + 1}/${detailBatches.length} FAILED:`, result.status, JSON.stringify(result.body));
      adherenceOk = false;
    } else {
      detailTotal += batch.length;
    }
  }
  console.log(`[jp-adherence] JP Adherence upload: ${detailTotal}/${adherenceDetailRecent.length} detail rows + ${adherenceDaily.length} daily rows saved across ${detailBatches.length} batch(es).`);
  if (!adherenceOk) process.exitCode = 1;

  const splitOk = await uploadBatched(appUrl, apiKey, "Monthly Split", "/api/jp-adherence/upload/monthly-split", monthlySplit, (batch, isFirst) => ({ rows: batch, replace: isFirst }));
  if (!splitOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[jp-adherence] FAILED:", err);
  process.exitCode = 1;
});

// Entry point for the live Active Outlets + Timestamps sync. Fetches YTD fact
// lines from the "pine" field-force MySQL DB once, builds the outlet-level YTD
// summary and its monthly trend from the full set, then filters the same
// events down to the current calendar month for the Timestamps/call build —
// the current month is always inside a YTD range, so no second fact-line
// fetch is needed (only no-sale visits are fetched separately, current-month
// only, matching the source script's own scope). POSTs to two upload routes;
// a failure in one doesn't block the other. Run with: npm run active-outlets:sync
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchNoSaleVisits, fetchOutlets, fetchProducts, fetchUsers, resolveNoSalesColumns } from "./query";
import { buildActiveOutlets, buildActiveOutletsMonthly, buildRepCalls, collapseToPurchaseEvents } from "./transform";
import principalsData from "../reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";
// A single request carrying tens of thousands of rows trips Netlify's request
// payload/timeout limits before the server side ever gets to chunk its own DB
// writes (the same class of problem export-and-upload.ps1 documents for its
// Brand&Customer sheet) — batch the HTTP requests themselves, client-side.
const BATCH_SIZE = 2000;

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

/** Uploads Active Outlets in batches — each batch upserts independently, so
 *  batching here has no special ordering requirement (unlike Timestamps below). */
async function uploadActiveOutletsBatched(
  appUrl: string,
  apiKey: string,
  outletRows: ReturnType<typeof buildActiveOutlets>,
  monthlyRows: ReturnType<typeof buildActiveOutletsMonthly>
): Promise<boolean> {
  const outletBatches = chunk(outletRows, BATCH_SIZE);
  let ok = true;
  let totalOutlets = 0;
  for (const [i, batch] of outletBatches.entries()) {
    // Monthly rows are few (one per Month+Principal+SalesRole) — piggyback them on
    // the first batch only, rather than adding a third top-level batching loop.
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", {
      outlets: batch,
      monthly: i === 0 ? monthlyRows : [],
    });
    if (!result.ok) {
      console.error(`[active-outlets] Active Outlets upload batch ${i + 1}/${outletBatches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      totalOutlets += batch.length;
    }
  }
  console.log(`[active-outlets] Active Outlets upload: ${totalOutlets}/${outletRows.length} outlet rows saved across ${outletBatches.length} batch(es).`);
  return ok;
}

/** Uploads Timestamps in batches. "replace: true" only on the first batch clears
 *  RepCall once; later batches only insert, so they don't wipe out what earlier
 *  batches in this same sync just wrote. */
async function uploadCallsBatched(appUrl: string, apiKey: string, callRows: ReturnType<typeof buildRepCalls>): Promise<boolean> {
  const batches = chunk(callRows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", { calls: batch, replace: i === 0 });
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
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in Netlify).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const calendarMonthsElapsed = now.getUTCMonth() + 1;
  const { start: monthStart, end: monthEnd } = currentMonthWindow(now);

  console.log(`[active-outlets] Connecting to ${config.host}/${config.database} (YTD ${ytdStart.toISOString().slice(0, 10)} - ${now.toISOString().slice(0, 10)})...`);

  const { outlets, users, products, factLines, noSaleColumns, noSaleVisits } = await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products, factLines] = await Promise.all([
      fetchOutlets(conn),
      fetchUsers(conn),
      fetchProducts(conn),
      fetchFactLines(conn, ytdStart, now),
    ]);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, monthStart, monthEnd) : [];
    return { outlets, users, products, factLines, noSaleColumns, noSaleVisits };
  });

  console.log(`[active-outlets] Dimensions: ${outlets.length} outlets, ${users.length} users, ${products.length} products.`);
  console.log(`[active-outlets] Fetched ${factLines.length} YTD sale/order lines.`);
  if (!noSaleColumns) {
    console.log("[active-outlets] NOTE: pine.nosales columns could not be auto-detected — unproductive calls will not be reported this run.");
  } else {
    console.log(`[active-outlets] Fetched ${noSaleVisits.length} no-sale visits for the current month.`);
  }

  const { events, unmatchedSkuCount } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const distinctOutletsYtd = new Set(events.map((e) => e.customerId)).size;
  console.log(`[active-outlets] Collapsed to ${events.length} purchase events; ${distinctOutletsYtd} distinct buying outlets YTD.`);
  if (unmatchedSkuCount > 0) {
    console.log(`[active-outlets] NOTE: ${unmatchedSkuCount} purchase/SKU lines had no resolvable Cost Centre — still counted as calls/productive calls, just excluded from Active Outlets' per-Cost-Centre figures.`);
  }

  const outletRows = buildActiveOutlets(events, outlets, users, year, calendarMonthsElapsed);
  const monthlyRows = buildActiveOutletsMonthly(events);
  console.log(`[active-outlets] Built ${outletRows.length} Active Outlet rows, ${monthlyRows.length} monthly trend rows.`);

  const monthEvents = events.filter((e) => e.purchaseTime >= monthStart && e.purchaseTime <= monthEnd);
  const callRows = buildRepCalls(monthEvents, noSaleVisits, outlets, users);
  console.log(`[active-outlets] Built ${callRows.length} Timestamps (call) rows for the current month.`);

  const outletsOk = await uploadActiveOutletsBatched(appUrl, apiKey, outletRows, monthlyRows);
  if (!outletsOk) process.exitCode = 1;

  const callsOk = await uploadCallsBatched(appUrl, apiKey, callRows);
  if (!callsOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[active-outlets] FAILED:", err);
  process.exitCode = 1;
});

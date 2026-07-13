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
    console.log(`[active-outlets] NOTE: ${unmatchedSkuCount} purchase/SKU lines excluded because the SKU's Cost Centre could not be resolved.`);
  }

  const outletRows = buildActiveOutlets(events, outlets, users, year, calendarMonthsElapsed);
  const monthlyRows = buildActiveOutletsMonthly(events);
  console.log(`[active-outlets] Built ${outletRows.length} Active Outlet rows, ${monthlyRows.length} monthly trend rows.`);

  const monthEvents = events.filter((e) => e.purchaseTime >= monthStart && e.purchaseTime <= monthEnd);
  const callRows = buildRepCalls(monthEvents, noSaleVisits, outlets, users);
  console.log(`[active-outlets] Built ${callRows.length} Timestamps (call) rows for the current month.`);

  const outletsUpload = await postJson(appUrl, apiKey, "/api/active-outlets/upload", { outlets: outletRows, monthly: monthlyRows });
  if (!outletsUpload.ok) {
    console.error("[active-outlets] Active Outlets upload FAILED:", outletsUpload.status, JSON.stringify(outletsUpload.body));
    process.exitCode = 1;
  } else {
    console.log("[active-outlets] Active Outlets upload succeeded:", JSON.stringify(outletsUpload.body));
  }

  const callsUpload = await postJson(appUrl, apiKey, "/api/timestamps/upload", { calls: callRows });
  if (!callsUpload.ok) {
    console.error("[active-outlets] Timestamps upload FAILED:", callsUpload.status, JSON.stringify(callsUpload.body));
    process.exitCode = 1;
  } else {
    console.log("[active-outlets] Timestamps upload succeeded:", JSON.stringify(callsUpload.body));
  }
}

main().catch((err) => {
  console.error("[active-outlets] FAILED:", err);
  process.exitCode = 1;
});

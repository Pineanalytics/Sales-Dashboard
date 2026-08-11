// Entry point for the live Sales sync. Unlike run.ts (read-only, local output
// only), this script pushes to production: fetches YTD_Raw from SAP, transforms
// it exactly like the shadow bridge does (reusing the same queries/transform
// code, now verified against live Revenue/COGS/GrossProfit within tolerance —
// see the Gross Profit fix in transform/buildMonthlySales.ts), and POSTs to
// /api/sales/upload (same UPLOAD_API_KEY auth as pl-bridge). Manual trigger for
// now — not wired into Task Scheduler. Run with: npm run sales:sync
//
// Stock is deliberately NOT synced by this script — buildStock.ts doesn't
// compute rrWeekValue/rrWeekVolume/daysCover/action (needs SAP_Raw's weekly
// run-rate, out of scope), so pushing Stock now would make every item read as
// "No Sales Data" in the live Stock Balance view. Stock stays Excel-sourced
// until that gap is closed.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchYtdRaw } from "./queries/ytdRaw";
import { fetchDailySalesRaw } from "./queries/dailySalesRaw";
import { loadEmployeeMaster, loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildMonthlySales } from "./transform/buildMonthlySales";
import { buildDailySales } from "./transform/buildDailySales";
import { buildDailyCustomerSales, buildDailyRepSales, buildMonthlyCustomerSales, buildMonthlyRepSales } from "./transform/buildRepSales";
import principalsData from "./reference/principals.json";

// Trailing window for the day-grain feed (Executive Overview's Week 1-4/Daily
// Projection cards) — start of last month through today. Bounded deliberately:
// unlike YTD_Raw's whole-year fetch, this table accumulates one row per
// Principal x Day (not x Month), so it only ever needs enough history to cover
// "this week" even on the 1st of a new month, plus last month for reference.
function dailyWindow(asOfDate: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - 1, 1));
  const end = asOfDate;
  return { start, end };
}

const DEFAULT_APP_URL = "https://pinefrostdb.com";

async function main() {
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in the VPS's .env).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const asOfDate = new Date();
  console.log(`[sales-sync] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)})...`);

  const { start: dailyStart, end: dailyEnd } = dailyWindow(asOfDate);

  const [ytdRows, dailyRawRows, products, warehousesData, employees] = await Promise.all([
    withConnection(config, (pool) => fetchYtdRaw(pool, asOfDate)),
    withConnection(config, (pool) => fetchDailySalesRaw(pool, dailyStart, dailyEnd)),
    loadProducts(),
    loadWarehouses(),
    loadEmployeeMaster(),
  ]);
  console.log(
    `[sales-sync] Fetched ${ytdRows.length} YTD_Raw rows and ${dailyRawRows.length} daily rows (${dailyStart.toISOString().slice(0, 10)} to ${dailyEnd.toISOString().slice(0, 10)}). Loaded ${products.length} product rows, ${warehousesData.length} warehouse rows, and ${employees.length} Employee Roaster rows from Postgres.`
  );

  const monthlySales = buildMonthlySales(ytdRows, products, warehousesData, principalsData);
  const dailySales = buildDailySales(dailyRawRows, products, warehousesData, principalsData);
  const monthlyRepSales = buildMonthlyRepSales(ytdRows, products, warehousesData, principalsData, employees);
  const dailyRepSales = buildDailyRepSales(dailyRawRows, products, warehousesData, principalsData, employees);
  const monthlyCustomerSales = buildMonthlyCustomerSales(ytdRows, products, warehousesData, principalsData);
  const dailyCustomerSales = buildDailyCustomerSales(dailyRawRows, products, warehousesData, principalsData);
  console.log(
    `[sales-sync] Built ${monthlySales.length} principal-month rows, ${dailySales.length} principal-day rows, ${monthlyRepSales.length} rep-month rows, ${dailyRepSales.length} rep-day rows, ${monthlyCustomerSales.length} customer-month rows, and ${dailyCustomerSales.length} customer-day rows.`
  );

  const rows = monthlySales.map((r) => ({
    year: r.year,
    month: r.month,
    monthIndex: r.monthIndex,
    location: r.location,
    principal: r.principal,
    revenue: r.revenue,
    cogs: r.cogs,
    grossProfit: r.grossProfit,
  }));

  console.log(`[sales-sync] Uploading to ${appUrl}/api/sales/upload...`);
  const response = await fetch(`${appUrl}/api/sales/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ rows }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }
  console.log(`[sales-sync] Upload succeeded. Saved ${body.count} rows.`);

  const dailyRows = dailySales.map((r) => ({
    date: r.date,
    location: r.location,
    principal: r.principal,
    revenue: r.revenue,
    cogs: r.cogs,
    grossProfit: r.grossProfit,
  }));

  console.log(`[sales-sync] Uploading to ${appUrl}/api/sales/upload-daily...`);
  const dailyResponse = await fetch(`${appUrl}/api/sales/upload-daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ rows: dailyRows }),
  });

  const dailyBody = await dailyResponse.json();
  if (!dailyResponse.ok) {
    throw new Error(`Daily upload rejected (HTTP ${dailyResponse.status}): ${JSON.stringify(dailyBody)}`);
  }
  console.log(`[sales-sync] Daily upload succeeded. Saved ${dailyBody.count} rows.`);

  console.log(`[sales-sync] Uploading rep-level SAP actuals to ${appUrl}/api/sales/upload-reps...`);
  const repResponse = await fetch(`${appUrl}/api/sales/upload-reps`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ monthlyRows: monthlyRepSales, dailyRows: dailyRepSales }),
  });
  const repBody = await repResponse.json();
  if (!repResponse.ok) {
    throw new Error(`Rep-level upload rejected (HTTP ${repResponse.status}): ${JSON.stringify(repBody)}`);
  }
  console.log(
    `[sales-sync] Rep-level upload succeeded. Saved ${repBody.monthlyRows} monthly and ${repBody.dailyRows} daily rows; ${repBody.unmatchedMonthlyRows} monthly rows remain unmatched to Employee Roaster.`
  );

  console.log(`[sales-sync] Uploading Brand&Customer SAP actuals to ${appUrl}/api/sales/upload-brand-customer...`);
  const brandCustomerResponse = await fetch(`${appUrl}/api/sales/upload-brand-customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ monthlyRows: monthlyCustomerSales, dailyRows: dailyCustomerSales }),
  });
  const brandCustomerBody = await brandCustomerResponse.json();
  if (!brandCustomerResponse.ok) {
    throw new Error(`Brand&Customer upload rejected (HTTP ${brandCustomerResponse.status}): ${JSON.stringify(brandCustomerBody)}`);
  }
  console.log(`[sales-sync] Brand&Customer upload succeeded. Saved ${brandCustomerBody.monthlyRows} monthly and ${brandCustomerBody.dailyRows} daily rows.`);

  // RepContribution/DailyTarget now use SAP sales actuals, so refresh them in
  // the same transaction cycle rather than waiting for the next JPA sync.
  const derivedResponse = await fetch(`${appUrl}/api/jp-adherence/recompute-derived`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: "{}",
  });
  const derivedBody = await derivedResponse.json();
  if (!derivedResponse.ok) {
    throw new Error(`Derived target recompute rejected (HTTP ${derivedResponse.status}): ${JSON.stringify(derivedBody)}`);
  }
  console.log(`[sales-sync] Recomputed Target contributions from SAP actuals: ${JSON.stringify(derivedBody.contribution)}.`);
}

main().catch((err) => {
  console.error("[sales-sync] FAILED:", err);
  process.exitCode = 1;
});

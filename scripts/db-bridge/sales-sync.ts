// Entry point for the live Sales sync. Unlike run.ts (read-only, local output
// only), this script pushes to production: fetches sales data from SAP,
// transforms it exactly like the shadow bridge does (reusing the same
// queries/transform code, now verified against live Revenue/COGS/GrossProfit
// within tolerance — see the Gross Profit fix in transform/buildMonthlySales.ts),
// and POSTs to the app's /api/sales/* upload routes (same UPLOAD_API_KEY auth
// as pl-bridge). Wired into Task Scheduler as SalesDashboard-SalesSync, every
// 30 minutes, via scripts/sales-sync.ps1 (which opens the Postgres SSH tunnel
// this script's Prisma-backed reference-data reads need). Run directly with:
// npm run sales:sync -- --backfill (or without the flag for a routine run).
//
// Two modes:
//   --backfill  Full historical fetch (YTD_Raw's own YTD+LYTD branches, i.e.
//               the current year plus the immediately prior year — today that's
//               2025+2026, matching the "backfill from January 2025" decision)
//               plus the full current year of daily-grain rows. Run this once
//               manually; NOT part of the routine 30-minute cadence.
//   (default)   Routine refresh. Skips the full-year YTD_Raw scan entirely —
//               only fetches the CURRENT MONTH's day-grain rows, then derives
//               the monthly-grain rollup from those same rows via
//               dailyRowsToMonthlyInput (reusing the exact monthly aggregation
//               functions the backfill path uses). This is what keeps routine
//               runs cheap: every 30 minutes, only the current month's row in
//               SalesRecord/SalesRepActual/BrandCustomerActual gets touched —
//               older months, already correct from the last backfill, are left
//               alone. Trade-off: a rare backdated edit to an already-closed
//               month won't be picked up until the next --backfill re-run.
//
// Stock is deliberately NOT synced by this script — buildStock.ts doesn't
// compute rrWeekValue/rrWeekVolume/daysCover/action (needs SAP_Raw's weekly
// run-rate, out of scope), so pushing Stock now would make every item read as
// "No Sales Data" in the live Stock Balance view. Stock stays Excel-sourced
// until that gap is closed.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchYtdRaw, type YtdRawRow } from "./queries/ytdRaw";
import { fetchDailySalesRaw } from "./queries/dailySalesRaw";
import { loadEmployeeMaster, loadPrincipals, loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildMonthlySales } from "./transform/buildMonthlySales";
import { buildDailySales } from "./transform/buildDailySales";
import {
  buildDailyCustomerSales,
  buildDailyRepSales,
  buildMonthlyCustomerSales,
  buildMonthlyRepSales,
  dailyRowsToMonthlyInput,
} from "./transform/buildRepSales";

const isBackfill = process.argv.includes("--backfill");

// Daily-grain fetch window. Backfill: Jan 1 of the CURRENT year through today
// (the "widen to the full current year" decision — daily grain is not backfilled
// all the way to 2025; that's YTD_Raw's own YTD+LYTD job, monthly/customer grain
// only). Routine refresh: just the current month.
function dailyWindow(asOfDate: Date, backfill: boolean): { start: Date; end: Date } {
  const start = backfill
    ? new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1))
    : new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1));
  return { start, end: asOfDate };
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
  console.log(
    `[sales-sync] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)}, mode: ${isBackfill ? "BACKFILL" : "routine"})...`
  );

  const { start: dailyStart, end: dailyEnd } = dailyWindow(asOfDate, isBackfill);

  const [dailyRawRows, products, warehousesData, employees, principalsData] = await Promise.all([
    withConnection(config, (pool) => fetchDailySalesRaw(pool, dailyStart, dailyEnd)),
    loadProducts(),
    loadWarehouses(),
    loadEmployeeMaster(),
    loadPrincipals(),
  ]);

  // Only the backfill path runs the heavier full-year (x2 years) YTD_Raw scan —
  // sequential after the above, not parallel, since backfill is a rare, manually
  // -triggered operation, not the hot routine path worth optimizing further.
  const ytdRows: YtdRawRow[] = isBackfill ? await withConnection(config, (pool) => fetchYtdRaw(pool, asOfDate)) : [];

  console.log(
    `[sales-sync] Fetched ${isBackfill ? `${ytdRows.length} YTD_Raw rows (current + prior year) and ` : ""}${dailyRawRows.length} daily rows (${dailyStart.toISOString().slice(0, 10)} to ${dailyEnd.toISOString().slice(0, 10)}). Loaded ${products.length} product rows, ${warehousesData.length} warehouse rows, and ${employees.length} Employee Roaster rows from Postgres.`
  );

  // Routine refreshes derive the monthly-grain rollup from the current-month
  // day-grain rows already fetched above (dailyRowsToMonthlyInput), instead of
  // re-running YTD_Raw — see this file's header comment for why.
  const monthlyInputRows: YtdRawRow[] = isBackfill ? ytdRows : dailyRowsToMonthlyInput(dailyRawRows);

  const monthlySales = buildMonthlySales(monthlyInputRows, products, warehousesData, principalsData);
  const dailySales = buildDailySales(dailyRawRows, products, warehousesData, principalsData);
  const monthlyRepSales = buildMonthlyRepSales(monthlyInputRows, products, warehousesData, principalsData, employees);
  const dailyRepSales = buildDailyRepSales(dailyRawRows, products, warehousesData, principalsData, employees);
  const monthlyCustomerSales = buildMonthlyCustomerSales(monthlyInputRows, products, warehousesData, principalsData);
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

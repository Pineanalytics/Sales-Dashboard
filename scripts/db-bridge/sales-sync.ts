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
import { loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildMonthlySales } from "./transform/buildMonthlySales";
import principalsData from "./reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";

async function main() {
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in Netlify).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const asOfDate = new Date();
  console.log(`[sales-sync] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)})...`);

  const [ytdRows, products, warehousesData] = await Promise.all([
    withConnection(config, (pool) => fetchYtdRaw(pool, asOfDate)),
    loadProducts(),
    loadWarehouses(),
  ]);
  console.log(`[sales-sync] Fetched ${ytdRows.length} YTD_Raw rows. Loaded ${products.length} product rows and ${warehousesData.length} warehouse rows from Postgres.`);

  const monthlySales = buildMonthlySales(ytdRows, products, warehousesData, principalsData);
  console.log(`[sales-sync] Built ${monthlySales.length} monthly-sales rows.`);

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
}

main().catch((err) => {
  console.error("[sales-sync] FAILED:", err);
  process.exitCode = 1;
});

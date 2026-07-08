// Entry point for the live P&L sync. Unlike scripts/db-bridge/run.ts (read-only,
// local output only), this script actually pushes to production: fetches the
// current year's P&L from SAP, aggregates to monthly grain, and POSTs to
// /api/pl/upload (same UPLOAD_API_KEY auth as the main Excel upload). Manual
// trigger for now — not wired into Task Scheduler. Run with: npm run pl:sync
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "../db-bridge/sql";
import { fetchPLByCostCentre } from "./query";
import { buildPL } from "./transform";
import principalsData from "../db-bridge/reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";

async function main() {
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in Netlify).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));

  console.log(`[pl-bridge] Connecting to ${config.server}/${config.database} for ${now.getUTCFullYear()} P&L...`);
  const rawRows = await withConnection(config, (pool) => fetchPLByCostCentre(pool, startDate, endDate));
  console.log(`[pl-bridge] Fetched ${rawRows.length} journal-entry lines.`);

  const { rows, unmatchedCostCentres } = buildPL(rawRows, principalsData);
  console.log(`[pl-bridge] Aggregated to ${rows.length} monthly P&L rows.`);
  if (unmatchedCostCentres.length > 0) {
    console.warn(
      `[pl-bridge] WARNING: ${unmatchedCostCentres.length} Cost Centre value(s) don't match a known Active principal (included anyway): ${unmatchedCostCentres.join(", ")}`
    );
  }

  console.log(`[pl-bridge] Uploading to ${appUrl}/api/pl/upload...`);
  const response = await fetch(`${appUrl}/api/pl/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ rows }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }
  console.log(`[pl-bridge] Upload succeeded. Saved ${body.count} rows.`);
}

main().catch((err) => {
  console.error("[pl-bridge] FAILED:", err);
  process.exitCode = 1;
});

// One-off backfill: restores July's RepCall rows after the retainFrom fix
// widened retention from "current month only" to TIMESTAMPS_RETENTION_MONTHS
// trailing months. July was purged by the old current-month-only retainFrom
// the moment the calendar rolled to August, before the fix landed — Pine
// still has the source data, so re-fetch and upload it directly, bypassing
// the live sync's rolling-window/retention logic entirely.
//
// Run once: node --import tsx scripts/db-bridge/timestamps/backfill-july.ts
// Delete this file after a successful run.
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import {
  fetchFactLines,
  fetchNoSaleVisits,
  fetchOutletsByIds,
  fetchProductsByIds,
  fetchUsersByIds,
  resolveNoSalesColumns,
} from "../active-outlets/query";
import { buildRepCalls, collapseToPurchaseEvents } from "../active-outlets/transform";
import principalsData from "../reference/principals.json";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BATCH_SIZE = 2000;

const JULY_START = new Date(Date.UTC(2026, 6, 1));
const JULY_END = new Date(Date.UTC(2026, 7, 1));

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
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
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env (same value configured on the VPS).");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  console.log(`[backfill-july] Connecting to ${config.host}/${config.database} (${JULY_START.toISOString()} - ${JULY_END.toISOString()})...`);
  const { factLines, noSaleColumns, noSaleVisits, outlets, users, products } = await withCoverageConnection(config, async (conn) => {
    const factLines = await fetchFactLines(conn, JULY_START, JULY_END);
    const noSaleColumns = await resolveNoSalesColumns(conn);
    const noSaleVisits = noSaleColumns ? await fetchNoSaleVisits(conn, noSaleColumns, JULY_START, JULY_END) : [];

    const outletIds = [...factLines.map((row) => row.customerId), ...noSaleVisits.map((row) => row.customerId)];
    const userIds = [...factLines.map((row) => row.userId), ...noSaleVisits.map((row) => row.userId)];
    const productIds = factLines.map((row) => row.itemId);
    const [outlets, users, products] = await Promise.all([
      fetchOutletsByIds(conn, outletIds),
      fetchUsersByIds(conn, userIds),
      fetchProductsByIds(conn, productIds),
    ]);
    return { factLines, noSaleColumns, noSaleVisits, outlets, users, products };
  });

  console.log(`[backfill-july] Fetched ${factLines.length} sale/order lines and ${noSaleVisits.length} no-sale visits.`);
  if (!noSaleColumns) {
    console.log("[backfill-july] NOTE: pine.nosales columns could not be auto-detected - unproductive calls are not included.");
  }

  const { events } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
  const callRows = buildRepCalls(events, noSaleVisits, outlets, users);
  console.log(`[backfill-july] Collapsed to ${events.length} purchase events and built ${callRows.length} call rows.`);

  if (callRows.length === 0) {
    console.log("[backfill-july] No rows to upload - nothing to do.");
    return;
  }

  const batches = chunk(callRows, BATCH_SIZE);
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/timestamps/upload", {
      calls: batch,
      // windowStart-only: clears just July's own (partial/stale) rows before
      // reinsert. retainFrom is deliberately omitted so this one-off run
      // can't purge anything outside July's own window.
      windowStart: i === 0 ? JULY_START.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[backfill-july] Batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      process.exitCode = 1;
      return;
    }
    total += batch.length;
    console.log(`[backfill-july] Batch ${i + 1}/${batches.length} uploaded (${batch.length} rows).`);
  }
  console.log(`[backfill-july] Done: uploaded ${total}/${callRows.length} call rows for July.`);
}

main().catch((err) => {
  console.error("[backfill-july] FAILED:", err);
  process.exitCode = 1;
});

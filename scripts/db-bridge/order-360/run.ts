// Entry point for the Order 360 sync. FULL mode (no watermark yet, i.e. the very
// first run) backfills the trailing 3 calendar months to date, pulled as several
// small concurrent chunks (see query.ts's fetchOrdersChunked - SAP_Orders/payments
// are missing indexes, so a single multi-month query would time out, same issue
// the user-supplied Order_360_Extractor.py documents and works around the same way).
// INCREMENTAL mode (watermark already exists) just re-pulls today's window and
// tops it up - it never touches or re-deletes anything older, so history already
// loaded stays exactly as-is. Intended to run once daily at 18:30 via Task
// Scheduler (scripts/order-360-sync.ps1) - see scripts/timestamps-sync.ps1 for the
// wrapper pattern.
//
// Run with: npm run order360:sync
process.loadEnvFile();

import mysql from "mysql2/promise";
import { loadCoverageConfigFromEnv } from "../coverage/mysql";
import { fetchOrders, fetchOrdersChunked } from "./query";
import { buildOrderRecords, type OrderRecordUploadRow } from "./transform";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "order-360";
const BACKFILL_MONTHS = 3;
const BATCH_SIZE = 500;

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
}

async function uploadOrdersBatched(appUrl: string, apiKey: string, rows: OrderRecordUploadRow[], windowStart: Date): Promise<boolean> {
  const batches = chunk(rows, BATCH_SIZE);
  let ok = true;
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/order-360/upload", {
      orders: batch,
      windowStart: i === 0 ? windowStart.toISOString() : undefined,
    });
    if (!result.ok) {
      console.error(`[order-360] Upload batch ${i + 1}/${batches.length} FAILED:`, result.status, JSON.stringify(result.body));
      ok = false;
    } else {
      total += batch.length;
    }
  }
  console.log(`[order-360] Upload: ${total}/${rows.length} order rows saved across ${batches.length} batch(es).`);
  return ok;
}

function backfillStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (BACKFILL_MONTHS - 1), 1));
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env (same value configured on the VPS).");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const syncState = await getSyncState(appUrl, apiKey);
  // ORDER360_FORCE_FULL=1 re-runs the full 3-month backfill even though a
  // watermark already exists - the upload route upserts (ON CONFLICT DO
  // UPDATE), so this is the way to true up already-loaded history after a
  // business-logic fix in query.ts, without a separate one-off script.
  const isFullMode = !syncState.lastFullResyncAt || process.env.ORDER360_FORCE_FULL === "1";

  const makeConnection = () =>
    mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });

  let orders;
  let windowStart: Date;

  if (isFullMode) {
    windowStart = backfillStart(now);
    console.log(`[order-360] Mode: FULL BACKFILL. Pulling ${windowStart.toISOString()} -> ${now.toISOString()} from ${config.host}/${config.database} in chunks...`);
    orders = await fetchOrdersChunked(makeConnection, windowStart, now);
  } else {
    windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    console.log(`[order-360] Mode: INCREMENTAL (today only). Connecting to ${config.host}/${config.database}...`);
    const conn = await makeConnection();
    try {
      orders = await fetchOrders(conn, windowStart, now);
    } finally {
      await conn.end();
    }
  }

  console.log(`[order-360] Fetched ${orders.length} order rows.`);
  const rows = buildOrderRecords(orders);
  console.log(`[order-360] Built ${rows.length} distinct order records.`);

  const ok = await uploadOrdersBatched(appUrl, apiKey, rows, windowStart);
  if (!ok) {
    process.exitCode = 1;
    console.log("[order-360] Skipping watermark update since the upload failed - next run will retry the same window.");
    return;
  }

  await setSyncState(appUrl, apiKey, {
    lastIncrementalAt: now.toISOString(),
    lastFullResyncAt: isFullMode ? now.toISOString() : undefined,
  });
  console.log(`[order-360] Sync watermark updated (${isFullMode ? "full" : "incremental"} mode).`);
}

main().catch((err) => {
  console.error("[order-360] FAILED:", err);
  process.exitCode = 1;
});

// Entry point for the Order 360 sync. Every run pulls a window of orders as several
// small concurrent chunks (see query.ts's fetchOrdersChunked - SAP_Orders/payments
// are missing indexes, so a wide single query would time out, same issue the
// user-supplied Order_360_Extractor.py documents and works around the same way) and
// replaces that window. Which window is decided by window.ts: FULL (the trailing 3
// calendar months) when there is no full pass on record or the last one is over ~22h
// old, otherwise ROLLING (the whole current month, plus the tail of the previous one
// early in a month). It used to re-read only today, which recorded each order once,
// before it was picked, dispatched or delivered, and never updated it afterwards.
// Runs hourly as the order-360-sync-worker Compose service
// (scripts/continuous-sync-worker.ts); scripts/order-360-sync.ps1 remains only for a
// local manual run.
//
// Run with: npm run order360:sync
// Local runs rely on .env, while the VPS injects its bridge address through
// Docker. Never load the fallback file when Docker has supplied the private
// bridge address; it would overwrite that address and use the public proxy.
if (!process.env.PL_BRIDGE_APP_URL) process.loadEnvFile();

import mysql from "mysql2/promise";
import { loadCoverageConfigFromEnv } from "../coverage/mysql";
import { fetchOrdersChunked } from "./query";
import { buildOrderRecords, type OrderRecordUploadRow } from "./transform";
import { planOrderSyncWindow } from "./window";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "order-360";
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

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env (same value configured on the VPS).");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const now = new Date();
  const syncState = await getSyncState(appUrl, apiKey);
  // ORDER360_FORCE_FULL=1 re-runs the full 3-month pass even though one is on
  // record - the upload route replaces the window it is sent, so this is the way
  // to true up already-loaded history after a business-logic fix in query.ts,
  // without a separate one-off script.
  const { mode, windowStart } = planOrderSyncWindow(now, syncState.lastFullResyncAt, process.env.ORDER360_FORCE_FULL === "1");
  const isFullMode = mode === "full";

  const makeConnection = () =>
    mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });

  console.log(`[order-360] Mode: ${isFullMode ? "FULL (trailing 3 months)" : "ROLLING (current month, with the tail of the previous one early in a month)"}. Pulling ${windowStart.toISOString()} -> ${now.toISOString()} from ${config.host}/${config.database} in chunks...`);
  const orders = await fetchOrdersChunked(makeConnection, windowStart, now);

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
  console.log(`[order-360] Sync watermark updated (${isFullMode ? "full" : "rolling"} mode).`);
}

main().catch((err) => {
  console.error("[order-360] FAILED:", err);
  process.exitCode = 1;
});

// Active Outlets bridge. The nightly full pass deliberately reads Pine in
// seven-day windows: a 2026 YTD scan is ~850k source lines, so holding it in
// one Node array previously exhausted the VPS worker heap. Each window is
// uploaded idempotently before the next is read; the final server-side pass
// derives all outlet and monthly summaries exactly once.
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { fetchFactLines, fetchOutlets, fetchProducts, fetchUsers } from "./query";
import { buildActiveOutletEvents, collapseToPurchaseEvents, type ActiveOutletEventRow } from "./transform";
import { loadEmployeeMaster, loadPrincipals } from "../reference/loadFromDb";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const BRIDGE_NAME = "active-outlets";
const FULL_RESYNC_AFTER_HOURS = 22;
const OVERLAP_BUFFER_HOURS = 3;
const BATCH_SIZE = 2_000;
const FULL_WINDOW_DAYS = 7;

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
}

function windows(start: Date, end: Date, full: boolean): { start: Date; end: Date }[] {
  if (!full) return [{ start, end }];
  const result: { start: Date; end: Date }[] = [];
  for (let cursor = new Date(start); cursor < end; ) {
    const next = new Date(Math.min(cursor.getTime() + FULL_WINDOW_DAYS * 86_400_000, end.getTime()));
    result.push({ start: cursor, end: next });
    cursor = next;
  }
  return result;
}

async function getSyncState(appUrl: string, apiKey: string): Promise<SyncState> {
  const response = await fetch(`${appUrl}/api/active-outlets/sync-state?bridge=${BRIDGE_NAME}`, { headers: { "x-upload-api-key": apiKey } });
  if (!response.ok) throw new Error(`Failed to read sync state: ${response.status} ${await response.text()}`);
  return response.json();
}

async function setSyncState(appUrl: string, apiKey: string, body: { lastIncrementalAt: string; lastFullResyncAt?: string }): Promise<void> {
  const response = await postJson(appUrl, apiKey, "/api/active-outlets/sync-state", { bridge: BRIDGE_NAME, ...body });
  if (!response.ok) throw new Error(`Failed to update sync state: ${response.status} ${JSON.stringify(response.body)}`);
}

async function uploadEventsBatched(
  appUrl: string,
  apiKey: string,
  eventRows: ActiveOutletEventRow[],
  year: string,
  calendarMonthsElapsed: number,
  deferDerivation: boolean
): Promise<boolean> {
  let total = 0;
  for (const [i, batch] of chunk(eventRows, BATCH_SIZE).entries()) {
    if (batch.length === 0) continue;
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", {
      events: batch,
      monthly: [],
      year,
      calendarMonthsElapsed,
      deferDerivation,
      // A nightly full pass refreshes source-owned metadata such as PJP and
      // validated coordinates even if the purchase event itself already exists.
      refreshMetadata: deferDerivation,
    });
    if (!result.ok) {
      console.error(`[active-outlets] Upload batch ${i + 1} FAILED:`, result.status, JSON.stringify(result.body));
      return false;
    }
    total += batch.length;
  }
  console.log(`[active-outlets] Uploaded ${total} event row(s) from this source window.`);
  return true;
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .sync.env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const calendarMonthsElapsed = now.getUTCMonth() + 1;
  const syncState = await getSyncState(appUrl, apiKey);
  const hoursSinceFullResync = syncState.lastFullResyncAt ? (now.getTime() - new Date(syncState.lastFullResyncAt).getTime()) / 3_600_000 : Infinity;
  const isFullMode = hoursSinceFullResync >= FULL_RESYNC_AFTER_HOURS;
  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const fetchStart = isFullMode
    ? ytdStart
    : new Date(Math.max(ytdStart.getTime(), (syncState.lastIncrementalAt ? new Date(syncState.lastIncrementalAt).getTime() : ytdStart.getTime()) - OVERLAP_BUFFER_HOURS * 3_600_000));
  const sourceWindows = windows(fetchStart, now, isFullMode);

  const [principalsData, employees] = await Promise.all([loadPrincipals(), loadEmployeeMaster()]);
  const activePjpByEmployeeCode = new Map(employees.filter((employee) => employee.active).map((employee) => [employee.employeeCode, employee]));
  console.log(`[active-outlets] ${isFullMode ? "FULL nightly" : "incremental"} sync: ${sourceWindows.length} source window(s), ${activePjpByEmployeeCode.size} active roster reps eligible for PJP ownership.`);

  let eventsOk = true;
  let sourceLines = 0;
  let eventCount = 0;
  let unmatchedSkuCount = 0;
  let newestEventTime = fetchStart;

  await withCoverageConnection(config, async (conn) => {
    const [outlets, users, products] = await Promise.all([fetchOutlets(conn), fetchUsers(conn), fetchProducts(conn)]);
    console.log(`[active-outlets] Dimensions: ${outlets.length} active outlets, ${users.length} users, ${products.length} products.`);
    for (const window of sourceWindows) {
      const factLines = await fetchFactLines(conn, window.start, window.end);
      sourceLines += factLines.length;
      const { events, unmatchedSkuCount: unmatched } = collapseToPurchaseEvents(factLines, outlets, users, products, principalsData);
      unmatchedSkuCount += unmatched;
      eventCount += events.length;
      for (const event of events) if (event.purchaseTime > newestEventTime) newestEventTime = event.purchaseTime;
      const eventRows = buildActiveOutletEvents(events, outlets, users, activePjpByEmployeeCode);
      console.log(`[active-outlets] ${window.start.toISOString().slice(0, 10)}-${window.end.toISOString().slice(0, 10)}: ${factLines.length} lines -> ${eventRows.length} events.`);
      if (!(await uploadEventsBatched(appUrl, apiKey, eventRows, year, calendarMonthsElapsed, isFullMode))) {
        eventsOk = false;
        break;
      }
    }
  });

  console.log(`[active-outlets] Processed ${sourceLines} lines into ${eventCount} events. Unmatched SKU lines: ${unmatchedSkuCount}.`);
  if (!eventsOk) {
    process.exitCode = 1;
    console.log("[active-outlets] Skipping watermark update; the next nightly run will retry.");
    return;
  }

  if (isFullMode) {
    const result = await postJson(appUrl, apiKey, "/api/active-outlets/upload", { finalizeFullResync: true, year, calendarMonthsElapsed });
    if (!result.ok) throw new Error(`Full-resync finalize failed: ${result.status} ${JSON.stringify(result.body)}`);
    console.log("[active-outlets] Full-resync finalized: outlet and monthly summaries re-derived, inactive sweep applied.");
  }
  await setSyncState(appUrl, apiKey, {
    lastIncrementalAt: newestEventTime.toISOString(),
    lastFullResyncAt: isFullMode ? now.toISOString() : undefined,
  });
  console.log(`[active-outlets] Sync watermark updated (${isFullMode ? "full" : "incremental"} mode).`);
}

main().catch((err) => {
  console.error("[active-outlets] FAILED:", err);
  process.exitCode = 1;
});

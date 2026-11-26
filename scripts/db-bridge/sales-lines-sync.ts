// SAP invoice and credit-note lines for the Customer extract's raw data (SalesLine). A separate, additive job: it reads one
// month at a time, resolves each line's principal the same way as the SFA-outlet sales, and pushes the lines to
// /api/sales/upload-sales-lines in small idempotent chunks followed by a per-month finalize that prunes lines left over from
// older runs (cancelled documents) and marks the month as held.
//
//   npm run sales-lines:sync                          current month
//   npm run sales-lines:sync -- --months=2            current + previous month
//   npm run sales-lines:sync -- --from=2026-01 --to=2026-06
//   npm run sales-lines:sync -- --dry-run [...]       read + build + print totals, upload nothing
//
// Run daily for the last 2 months by the sap-sync-worker; older months are a manual run.
try {
  process.loadEnvFile(process.env.SFA_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { randomUUID } from "node:crypto";
import { loadConfigFromEnv, withConnection } from "./sql";
import { loadProducts, loadWarehouses, type ProductRow } from "./reference/loadFromDb";
import { fetchSalesDetailLines } from "./queries/salesDetailLines";
import { resolveLinePrincipal } from "./transform/buildSfaSales";
import { sfaMonthLabel, sfaWindowFor } from "./sfa/syncMonth";
import { monthRange } from "./sfa/monthRange";
import type { WarehouseRow } from "./transform/buildMonthlySales";
import { splitSfaCustomer, type SalesLineRecord } from "@/lib/salesLines";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const CHUNK_SIZE = 2000;

async function post(appUrl: string, apiKey: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${appUrl}/api/sales/upload-sales-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Sales lines upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const asOf = new Date();
  const months = monthRange(args, asOf);
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY ?? "";
  if (!dryRun && !apiKey) throw new Error("Missing UPLOAD_API_KEY — set it in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  let products: ProductRow[] = [];
  let warehouses: WarehouseRow[] = [];
  try {
    [products, warehouses] = await Promise.all([loadProducts(), loadWarehouses()]);
  } catch (err) {
    if (!dryRun) throw err;
    console.warn("[sales-lines] Product Master unreachable — dry run falls back to prefix rules only.");
  }
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));

  console.log(`[sales-lines] ${dryRun ? "DRY RUN " : ""}${months.map(sfaMonthLabel).join(", ")} against ${config.server}/${config.database}.`);
  for (const month of months) {
    const { start, end } = sfaWindowFor(month, asOf);
    const read = await withConnection(config, (pool) => fetchSalesDetailLines(pool, start, end));
    const lines: SalesLineRecord[] = read.map((line) => ({ ...line, principal: resolveLinePrincipal(line, productByItemNo, warehouseByCode).principal }));
    // A month with nothing in it is far more likely a bad read than a month without sales: never clear stored lines for it.
    if (lines.length === 0) {
      console.warn(`[sales-lines] ${sfaMonthLabel(month)}: SAP returned no lines; the stored month is left as it is.`);
      continue;
    }
    if (dryRun) {
      const prefilled = lines.filter((line) => splitSfaCustomer(line.sfaName, line.customerName).remarks === "Prefilled").length;
      const sales = lines.reduce((sum, line) => sum + line.salesAmount, 0);
      console.log(`[sales-lines] ${sfaMonthLabel(month)} DRY RUN: ${lines.length} lines, sales ${Math.round(sales).toLocaleString("en-KE")}, ${prefilled} with no SFA name.`);
      continue;
    }
    const syncToken = randomUUID().slice(0, 18);
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) await post(appUrl, apiKey, { mode: "chunk", syncToken, lines: lines.slice(i, i + CHUNK_SIZE) });
    const done = await post(appUrl, apiKey, { mode: "finalize", syncToken, period: { year: String(month.year), monthIndex: month.monthIndex }, lineCount: lines.length });
    console.log(`[sales-lines] ${sfaMonthLabel(month)}: saved ${lines.length} lines; pruned ${done.pruned} stale lines.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sales-lines] FAILED:", err);
    process.exit(1);
  });

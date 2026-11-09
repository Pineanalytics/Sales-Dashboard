// Stock-receipt sync: reads the month's goods receipts, returns, AP credits and related stock movements from SAP's stock ledger, attributes them to principals, and pushes
// them to /api/purchases/upload in small idempotent chunks followed by a per-month finalize that prunes rows left over from older runs. Additive: it touches only
// PurchaseReceiptLine.
//
//   npm run purchases:sync                          current month
//   npm run purchases:sync -- --months=2            current + previous month
//   npm run purchases:sync -- --from=2026-01 --to=2026-10
//   npm run purchases:sync -- --dry-run [...]       read + build + reconcile to the goods-receipt documents, upload nothing
//
// Run for the last 2 months by the sap-sync-worker (purchases job).
try {
  process.loadEnvFile(process.env.PURCHASES_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { randomUUID } from "node:crypto";
import { DOC_TYPE_LABELS, RECEIPT_DOC_TYPES, type PurchaseReceiptRow } from "@/lib/purchaseReceipts/types";
import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchGoodsReceiptDocumentTotal, fetchPurchaseReceipts } from "./queries/purchaseReceipts";
import { loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { sfaMonthLabel, sfaWindowFor, type SfaMonth } from "./sfa/syncMonth";
import { buildPurchaseReceipts, type PurchaseBuildStats } from "./transform/buildPurchaseReceipts";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const CHUNK_SIZE = 2000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const money = (value: number) => Math.round(value).toLocaleString("en-KE");

function monthRange(asOf: Date): SfaMonth[] {
  const current: SfaMonth = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  const parse = (value: string): SfaMonth => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Expected YYYY-MM, got "${value}".`);
    return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
  };
  let start = current;
  let end = current;
  if (option("months")) {
    const count = Number(option("months"));
    if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--months must be 1-24.");
    const d = new Date(Date.UTC(current.year, current.monthIndex - (count - 1), 1));
    start = { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
  }
  if (option("from")) start = parse(option("from")!);
  if (option("to")) end = parse(option("to")!);
  const months: SfaMonth[] = [];
  let y = start.year;
  let m = start.monthIndex;
  while (y < end.year || (y === end.year && m <= end.monthIndex)) {
    months.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return months;
}

async function post(appUrl: string, apiKey: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${appUrl}/api/purchases/upload`, { method: "POST", headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey }, body: JSON.stringify(payload) });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Purchases upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function printDryRun(month: SfaMonth, rows: PurchaseReceiptRow[], stats: PurchaseBuildStats, document: { docs: number; value: number }) {
  console.log(`\n[purchases-sync] ${sfaMonthLabel(month)} DRY RUN: ${rows.length} receipt lines from ${stats.sapRows} stock-ledger rows (${stats.droppedRows} netted to nothing).`);
  for (const type of RECEIPT_DOC_TYPES) {
    const of = rows.filter((r) => r.docType === type);
    if (of.length === 0) continue;
    console.log(`  ${DOC_TYPE_LABELS[type].padEnd(46)} docs ${String(new Set(of.map((r) => r.docEntry)).size).padStart(5)}  cases ${money(of.reduce((s, r) => s + r.cases, 0)).padStart(10)}  value ${money(of.reduce((s, r) => s + r.value, 0)).padStart(14)}`);
  }
  const grpo = rows.filter((r) => r.docType === "GOODS_RECEIPT_PO").reduce((s, r) => s + r.value, 0);
  console.log(`  RECONCILE goods receipts: stock ledger ${money(grpo)} vs documents (PDN1) ${money(document.value)} over ${document.docs} documents | diff ${money(grpo - document.value)}`);
  console.log(`  net of everything: ${money(rows.reduce((s, r) => s + r.value, 0))}; empties warehouses: ${money(rows.filter((r) => r.stockClass === "EMPTIES").reduce((s, r) => s + r.value, 0))}`);
  console.log(`  value by how the principal was found: ${JSON.stringify(Object.fromEntries(Object.entries(stats.valueBySource).map(([k, v]) => [k, Math.round(v)])))}`);
  const byPrincipal = new Map<string, number>();
  for (const r of rows) byPrincipal.set(r.principal, (byPrincipal.get(r.principal) ?? 0) + r.value);
  console.log("  by principal:", [...byPrincipal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([p, v]) => `${p} ${money(v)}`).join(" | "));
  const noPack = rows.filter((r) => r.cases === 0 && r.qty !== 0);
  console.log(`  lines with quantity but no pack size (cases show 0): ${noPack.length}`);
  if (stats.unallocatedItems.length > 0) console.log("  unallocated items:", stats.unallocatedItems.slice(0, 8).map((i) => `${i.itemCode} ${money(i.value)}`).join(" | "));
}

async function main() {
  const dryRun = flag("dry-run");
  const asOf = new Date();
  const months = monthRange(asOf);
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY ?? "";
  if (!dryRun && !apiKey) throw new Error("Missing UPLOAD_API_KEY - set it in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const [products, warehouses] = await Promise.all([loadProducts(), loadWarehouses()]);
  console.log(`[purchases-sync] ${dryRun ? "DRY RUN " : ""}${months.map(sfaMonthLabel).join(", ")} against ${config.server}/${config.database}; ${products.length} products, ${warehouses.length} warehouses.`);

  for (const month of months) {
    const { start, end } = sfaWindowFor(month, asOf);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    const sapRows = await withConnection(config, (pool) => fetchPurchaseReceipts(pool, from, to));
    const built = buildPurchaseReceipts(sapRows, products, warehouses);
    if (dryRun) {
      const document = await withConnection(config, (pool) => fetchGoodsReceiptDocumentTotal(pool, from, to));
      printDryRun(month, built.rows, built.stats, document);
      continue;
    }
    const syncToken = randomUUID().slice(0, 18);
    let saved = 0;
    for (let i = 0; i < built.rows.length; i += CHUNK_SIZE) {
      const body = await post(appUrl, apiKey, { mode: "chunk", syncToken, rows: built.rows.slice(i, i + CHUNK_SIZE) });
      saved += Number(body.rows ?? 0);
    }
    const finalize = await post(appUrl, apiKey, { mode: "finalize", syncToken, periods: [{ year: month.year, monthIndex: month.monthIndex }] });
    console.log(`[purchases-sync] ${sfaMonthLabel(month)}: saved ${saved} receipt lines; pruned ${finalize.pruned} stale lines. ${built.stats.unallocatedItems.length} items had no principal.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[purchases-sync] FAILED:", err);
    process.exit(1);
  });

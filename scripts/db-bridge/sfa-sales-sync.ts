// SFA-outlet-grain SAP sales sync. A separate, additive job: it never touches the
// existing sales tables or sales-sync.ts. It reads document-level SAP lines one
// month at a time, builds SalesDocument + SfaCustomerActual, and pushes them to
// /api/sales/upload-sfa in small idempotent chunks followed by a per-month
// finalize that prunes rows left over from older runs.
//
//   npm run sfa-sales:sync                          current month
//   npm run sfa-sales:sync -- --months=2            current + previous month
//   npm run sfa-sales:sync -- --backfill            1 Jan of the current year to now
//   npm run sfa-sales:sync -- --from=2026-01 --to=2026-06
//   npm run sfa-sales:sync -- --dry-run [...]       read + build + reconcile, upload nothing
//
// Not scheduled: run it by hand (or via the sap-sync-worker container, which has
// the SAP tunnel and Postgres access) until its output has been reviewed.
try {
  process.loadEnvFile(process.env.SFA_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { randomUUID } from "node:crypto";
import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchSfaSalesLines } from "./queries/sfaSalesLines";
import { fetchDailySalesRaw } from "./queries/dailySalesRaw";
import { loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildSfaSales, type SfaBuildResult } from "./transform/buildSfaSales";
import type { ProductRow } from "./reference/loadFromDb";
import type { WarehouseRow } from "./transform/buildMonthlySales";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const CHUNK_SIZE = 2000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

interface Month {
  year: number;
  monthIndex: number;
}

function monthRange(asOf: Date): Month[] {
  const current: Month = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  const parse = (value: string): Month => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Expected YYYY-MM, got "${value}".`);
    return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
  };
  let start = current;
  let end = current;
  if (flag("backfill")) start = { year: current.year, monthIndex: 0 };
  else if (option("months")) {
    const count = Number(option("months"));
    if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--months must be 1-24.");
    const d = new Date(Date.UTC(current.year, current.monthIndex - (count - 1), 1));
    start = { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
  }
  if (option("from")) start = parse(option("from")!);
  if (option("to")) end = parse(option("to")!);

  const months: Month[] = [];
  let y = start.year;
  let m = start.monthIndex;
  while (y < end.year || (y === end.year && m <= end.monthIndex)) {
    months.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}

function windowFor(month: Month, asOf: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(month.year, month.monthIndex, 1));
  const monthEnd = new Date(Date.UTC(month.year, month.monthIndex + 1, 0));
  return { start, end: monthEnd < asOf ? monthEnd : new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())) };
}

const label = (month: Month) => `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
const money = (value: number) => Math.round(value).toLocaleString("en-KE");

async function post(appUrl: string, apiKey: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${appUrl}/api/sales/upload-sfa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`SFA upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function printDryRunSummary(month: Month, built: SfaBuildResult, existingSales: number | null) {
  const { documents, monthlyRows, stats } = built;
  const total = documents.reduce((s, d) => s + d.netSales, 0);
  const sfaPct = documents.length ? (stats.sfaNamedDocuments / documents.length) * 100 : 0;
  const accounts = new Set(documents.map((d) => d.cardCode)).size;
  const outlets = new Set(monthlyRows.map((r) => `${r.cardCode}|${r.sfaCustomer.toLowerCase()}|${r.sfaContact}`)).size;
  console.log(`\n[sfa-sales-sync] ${label(month)} DRY RUN`);
  console.log(`  documents ${documents.length}, lines ${stats.lines}, monthly outlet rows ${monthlyRows.length}`);
  console.log(`  SFA-named documents ${stats.sfaNamedDocuments} (${sfaPct.toFixed(1)}%), account fallback ${stats.accountFallbackDocuments}`);
  console.log(`  billing accounts ${accounts} vs distinct SFA outlets ${outlets}`);
  console.log(`  net sales ${money(total)}${existingSales === null ? "" : ` | existing daily pipeline ${money(existingSales)} | diff ${money(total - existingSales)}`}`);
  console.log(`  sales by principal source: ${JSON.stringify(Object.fromEntries(Object.entries(stats.principalSalesBySource).map(([k, v]) => [k, Math.round(v)])))}`);
  const byPrincipal = new Map<string, number>();
  for (const row of monthlyRows) byPrincipal.set(row.principal, (byPrincipal.get(row.principal) ?? 0) + row.revenue);
  console.log("  top principals:", [...byPrincipal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, v]) => `${p} ${money(v)}`).join(" | "));
  if (stats.unallocatedItems.length > 0) {
    console.log("  unallocated items:", stats.unallocatedItems.slice(0, 5).map((i) => `${i.itemCode} ${money(i.sales)}`).join(" | "));
  }
  const gpDiff = documents.reduce((s, d) => s + d.grossProfit, 0) - documents.reduce((s, d) => s + d.sapGrossProfit, 0);
  console.log(`  GP: pipeline definition ${money(documents.reduce((s, d) => s + d.grossProfit, 0))} vs SAP GrssProfit ${money(documents.reduce((s, d) => s + d.sapGrossProfit, 0))} (diff ${money(gpDiff)})`);
}

async function main() {
  const dryRun = flag("dry-run");
  const asOf = new Date();
  const months = monthRange(asOf);
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
    console.warn("[sfa-sales-sync] Product Master unreachable — dry run falls back to prefix rules only (PRODUCT source will read 0).");
  }

  console.log(`[sfa-sales-sync] ${dryRun ? "DRY RUN " : ""}${months.map(label).join(", ")} against ${config.server}/${config.database}; ${products.length} products, ${warehouses.length} warehouses.`);
  const syncToken = randomUUID().slice(0, 18);

  for (const month of months) {
    const { start, end } = windowFor(month, asOf);
    const lines = await withConnection(config, (pool) => fetchSfaSalesLines(pool, start, end));
    const built = buildSfaSales(lines, products, warehouses);

    if (dryRun) {
      const existing = await withConnection(config, (pool) => fetchDailySalesRaw(pool, start, end));
      printDryRunSummary(month, built, existing.reduce((s, r) => s + r.salesAmount, 0));
      continue;
    }

    let savedDocs = 0;
    let savedRows = 0;
    for (let i = 0; i < built.documents.length; i += CHUNK_SIZE) {
      const body = await post(appUrl, apiKey, { mode: "chunk", syncToken, documents: built.documents.slice(i, i + CHUNK_SIZE) });
      savedDocs += Number(body.documents ?? 0);
    }
    for (let i = 0; i < built.monthlyRows.length; i += CHUNK_SIZE) {
      const body = await post(appUrl, apiKey, { mode: "chunk", syncToken, monthlyRows: built.monthlyRows.slice(i, i + CHUNK_SIZE) });
      savedRows += Number(body.monthlyRows ?? 0);
    }
    const finalize = await post(appUrl, apiKey, { mode: "finalize", syncToken, periods: [{ year: String(month.year), monthIndex: month.monthIndex }] });
    console.log(
      `[sfa-sales-sync] ${label(month)}: saved ${savedDocs} documents and ${savedRows} outlet rows; pruned ${finalize.prunedDocuments} stale documents and ${finalize.prunedMonthlyRows} stale outlet rows. ${built.stats.accountFallbackDocuments} documents had no SFA name.`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sfa-sales-sync] FAILED:", err);
    process.exit(1);
  });

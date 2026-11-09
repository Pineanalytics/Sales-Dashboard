// One month of the SFA-outlet sales refresh (SalesDocument + SfaCustomerActual), shared by sfa-sales-sync.ts (the standalone job) and
// brand-customer-sync.ts (which refreshes the SAP billing-account tables and the SFA customer names together). It reads that month's
// document-level SAP lines, builds the documents and outlet rows, and pushes them to /api/sales/upload-sfa in small idempotent chunks
// followed by a per-month finalize that prunes rows left over from older runs.
import { randomUUID } from "node:crypto";
import { withConnection, type BridgeConfig } from "../sql";
import { fetchSfaSalesLines } from "../queries/sfaSalesLines";
import { fetchDailySalesRaw } from "../queries/dailySalesRaw";
import { buildSfaSales, type SfaBuildResult } from "../transform/buildSfaSales";
import type { ProductRow } from "../reference/loadFromDb";
import type { WarehouseRow } from "../transform/buildMonthlySales";

const CHUNK_SIZE = 2000;

export interface SfaMonth {
  year: number;
  monthIndex: number;
}

export const sfaMonthLabel = (month: SfaMonth) => `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
const money = (value: number) => Math.round(value).toLocaleString("en-KE");

/** The days of a month to read: all of it, or up to today for the month in progress. */
export function sfaWindowFor(month: SfaMonth, asOf: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(month.year, month.monthIndex, 1));
  const monthEnd = new Date(Date.UTC(month.year, month.monthIndex + 1, 0));
  return { start, end: monthEnd < asOf ? monthEnd : new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())) };
}

export async function postSfa(appUrl: string, apiKey: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${appUrl}/api/sales/upload-sfa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`SFA upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  return body;
}

export function printSfaDryRun(month: SfaMonth, built: SfaBuildResult, existingSales: number | null): void {
  const { documents, monthlyRows, stats } = built;
  const total = documents.reduce((s, d) => s + d.netSales, 0);
  const sfaPct = documents.length ? (stats.sfaNamedDocuments / documents.length) * 100 : 0;
  const accounts = new Set(documents.map((d) => d.cardCode)).size;
  const outlets = new Set(monthlyRows.map((r) => `${r.cardCode}|${r.sfaCustomer.toLowerCase()}|${r.sfaContact}`)).size;
  console.log(`\n[sfa-sales-sync] ${sfaMonthLabel(month)} DRY RUN`);
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

export interface SfaMonthOptions {
  config: BridgeConfig;
  appUrl: string;
  /** Required unless `dryRun`. */
  apiKey: string;
  month: SfaMonth;
  asOf: Date;
  products: ProductRow[];
  warehouses: WarehouseRow[];
  dryRun: boolean;
}

/** Refreshes one month at SFA-outlet level (or, on a dry run, reads, builds and prints what it would save). Throws on a failed read or upload. */
export async function syncSfaMonth(options: SfaMonthOptions): Promise<void> {
  const { config, appUrl, apiKey, month, asOf, products, warehouses, dryRun } = options;
  const { start, end } = sfaWindowFor(month, asOf);
  const lines = await withConnection(config, (pool) => fetchSfaSalesLines(pool, start, end));
  const built = buildSfaSales(lines, products, warehouses);

  if (dryRun) {
    const existing = await withConnection(config, (pool) => fetchDailySalesRaw(pool, start, end));
    printSfaDryRun(month, built, existing.reduce((s, r) => s + r.salesAmount, 0));
    return;
  }

  const syncToken = randomUUID().slice(0, 18);
  let savedDocs = 0;
  let savedRows = 0;
  for (let i = 0; i < built.documents.length; i += CHUNK_SIZE) {
    const body = await postSfa(appUrl, apiKey, { mode: "chunk", syncToken, documents: built.documents.slice(i, i + CHUNK_SIZE) });
    savedDocs += Number(body.documents ?? 0);
  }
  for (let i = 0; i < built.monthlyRows.length; i += CHUNK_SIZE) {
    const body = await postSfa(appUrl, apiKey, { mode: "chunk", syncToken, monthlyRows: built.monthlyRows.slice(i, i + CHUNK_SIZE) });
    savedRows += Number(body.monthlyRows ?? 0);
  }
  const finalize = await postSfa(appUrl, apiKey, { mode: "finalize", syncToken, periods: [{ year: String(month.year), monthIndex: month.monthIndex }] });
  console.log(
    `[sfa-sales-sync] ${sfaMonthLabel(month)}: saved ${savedDocs} documents and ${savedRows} outlet rows; pruned ${finalize.prunedDocuments} stale documents and ${finalize.prunedMonthlyRows} stale outlet rows. ${built.stats.accountFallbackDocuments} documents had no SFA name.`
  );
}

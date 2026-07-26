// Day-grain sibling of buildMonthlySales.ts — identical Product->Principal/
// Warehouse->Location join, the same YTD_RAW_FIXUPS list, and the same Active-
// Principal filter, just collapsed to Date+Location+Principal instead of
// Year+Month+Location+Principal. Kept as a separate function (not a shared helper)
// so the already-verified monthly pipeline can't regress from a change made here.
import { normalizePrincipalKey } from "@/lib/normalize";
import type { DailySalesRawRow } from "../queries/dailySalesRaw";
import type { ProductRow } from "../reference/loadFromDb";
import type { WarehouseRow, PrincipalRow } from "./buildMonthlySales";

const YTD_RAW_FIXUPS: [string, string][] = [
  ["EABL-Nairobi", "EABL-Nyahururu"],
  ["Premier-Machakos", "Premier-Nairobi"],
  ["Suntory-Machakos", "Suntory-Nairobi"],
  ["Suntory-Nyahururu", "Suntory-Nairobi"],
];

function applyFixups(key: string): string {
  for (const [from, to] of YTD_RAW_FIXUPS) {
    if (key === from) return to;
  }
  return key;
}

export interface DailySalesRow {
  date: string; // "YYYY-MM-DD"
  principal: string;
  principalKey: string;
  location: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

export function buildDailySales(
  rawRows: DailySalesRawRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[]
): DailySalesRow[] {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));
  const activePrincipalByKey = new Map(
    principals.filter((p) => p.status === "Active").map((p) => [p.principal, p])
  );

  interface Agg {
    date: string;
    principal: string;
    location: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
  }
  const byKey = new Map<string, Agg>();

  for (const row of rawRows) {
    const product = productByItemNo.get(row.itemCode);
    if (!product || !product.principal) continue;

    const warehouse = row.whsCode ? warehouseByCode.get(row.whsCode) : undefined;
    const location = warehouse?.location ?? "Nairobi";

    const rawKey = `${product.principal}-${location}`;
    const fixedKey = applyFixups(rawKey);

    const principalRow = activePrincipalByKey.get(fixedKey);
    if (!principalRow) continue;

    const groupKey = `${row.date}|${principalRow.principal}`;
    let agg = byKey.get(groupKey);
    if (!agg) {
      agg = { date: row.date, principal: principalRow.principal, location: principalRow.location, revenue: 0, cogs: 0, grossProfit: 0 };
      byKey.set(groupKey, agg);
    }

    // Same Gross Profit recomputation as buildMonthlySales.ts (Gross Sales - COGS,
    // not SAP's raw GrssProfit field) — see that file's comment for the full "why."
    agg.revenue += row.salesAmount;
    agg.cogs += row.cogs;
    agg.grossProfit += row.grossMargin;
  }

  return Array.from(byKey.values()).map((agg) => ({
    date: agg.date,
    principal: agg.principal,
    principalKey: normalizePrincipalKey(agg.principal),
    location: agg.location,
    revenue: agg.revenue,
    cogs: agg.cogs,
    grossProfit: agg.grossProfit,
  }));
}

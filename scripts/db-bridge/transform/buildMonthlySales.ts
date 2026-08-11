// Replicates YTD_Raw's post-SQL M-code transformation chain: join Products (item ->
// principal/pack size) and Warehouses (warehouse -> location), build the composite
// "Principal-Location" key, apply the exact fixup list YTD_Raw itself applies (NOT
// the same list Stock_Balance applies — confirmed different, see queries/*.ts
// comments), join Principals and filter to Status="Active", then collapse to the
// app's actual Year+Month+Location+Principal grain (summing away the SQL-side
// Classification/TeamLeader/IsFreeSale dimensions).
//
// Both the "YTD" (current year) and "LYTD" (prior year) branches of YtdRawRow
// are processed — see the loop below for why.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { MonthlySalesRow } from "@/lib/types";
import type { YtdRawRow } from "../queries/ytdRaw";
import type { ProductRow } from "../reference/loadFromDb";

export interface WarehouseRow {
  warehouseCode: string;
  warehouseName: string;
  location: string;
  locationCode: string;
}

export interface PrincipalRow {
  key: string;
  principal: string;
  mainPrincipal: string;
  location: string;
  locationCode: string;
  status: string;
  teamLeader: string;
}

// Applied in this exact order — confirmed from YTD_Raw's own M code. Stock_Balance
// applies a different, non-overlapping fixup (see transform/buildStock.ts).
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildMonthlySales(
  ytdRows: YtdRawRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[]
): Omit<MonthlySalesRow, "target">[] {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));
  const activePrincipalByKey = new Map(
    principals.filter((p) => p.status === "Active").map((p) => [p.principal, p])
  );

  interface Agg {
    year: number;
    monthNo: number;
    principal: string;
    location: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
  }
  const byKey = new Map<string, Agg>();

  for (const row of ytdRows) {
    // Both "YTD" (current year) and "LYTD" (prior year) rows are processed here —
    // each row's own year/monthNo already fully identifies its period, so period
    // itself was never load-bearing for grouping, only previously used to filter
    // LYTD out. Including it lets this function double as the historical-backfill
    // path (see sales-sync.ts's --backfill flag) with zero query changes, since
    // ytdRaw.ts's YTD+LYTD branches together already span 2 full calendar years.
    const product = productByItemNo.get(row.itemCode);
    if (!product || !product.principal) continue;

    const warehouse = row.whsCode ? warehouseByCode.get(row.whsCode) : undefined;
    const location = warehouse?.location ?? "Nairobi";

    const rawKey = `${product.principal}-${location}`;
    const fixedKey = applyFixups(rawKey);

    const principalRow = activePrincipalByKey.get(fixedKey);
    if (!principalRow) continue; // not found or not Active — matches the M code's Filtered Active step

    const groupKey = `${row.year}|${row.monthNo}|${principalRow.principal}`;
    let agg = byKey.get(groupKey);
    if (!agg) {
      agg = {
        year: row.year,
        monthNo: row.monthNo,
        principal: principalRow.principal,
        location: principalRow.location,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
      };
      byKey.set(groupKey, agg);
    }

    // DAX: Revenue. = SUM(YTD_Raw[Sales Amount]); Cost Of Goods. = SUM(YTD_Raw[COGs]).
    //
    // Gross Profit is NOT SUM(YTD_Raw[Gross Profit]) despite that being the column
    // name match — the M code's own pipeline drops the SQL's raw [Gross Profit]
    // column (SAP's T1.GrssProfit, its internal moving-average-cost field) right
    // after the query via #"Removed Other Columns", then LATER re-adds a column of
    // the SAME NAME computed as [Gross Sales]-[COGS] (Qty*PriceBeforeDiscount minus
    // Qty*PurchasePrice) — sidestepping discount/credit-note noise per the user.
    // The SQL's [Gross Margin] column already replicates that exact recomputation;
    // row.grossProfit (SAP's raw field) is fetched only for reference/comparison,
    // never summed into the output. Confirmed against the real M code, not guessed.
    agg.revenue += row.salesAmount;
    agg.cogs += row.cogs;
    agg.grossProfit += row.grossMargin;
  }

  return Array.from(byKey.values()).map((agg) => ({
    year: String(agg.year),
    month: CANONICAL_MONTHS[agg.monthNo - 1],
    monthIndex: agg.monthNo - 1,
    location: agg.location,
    principal: agg.principal,
    principalKey: normalizePrincipalKey(agg.principal),
    revenue: agg.revenue,
    cogs: agg.cogs,
    grossProfit: agg.grossProfit,
    grossMarginPct: agg.revenue > 0 ? round1((agg.grossProfit / agg.revenue) * 100) : null,
  }));
}

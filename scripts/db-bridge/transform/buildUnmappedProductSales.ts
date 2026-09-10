import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { YtdRawRow } from "../queries/ytdRaw";
import type { ProductRow } from "../reference/loadFromDb";

/** A product/month/warehouse SAP fact that could not enter the dashboard's
 * mapped sales models because its Item Code is missing from Product Master. */
export interface UnmappedProductSalesRow {
  year: string;
  month: string;
  monthIndex: number;
  itemNo: string;
  itemDescription: string;
  warehouseCode: string;
  revenue: number;
  grossMargin: number;
  quantity: number;
}

/**
 * Retains the same exact Item Code matching rule used by the production sales
 * transforms. This is a worklist only: it never assigns a principal or alters
 * SAP data. The admin must review a suggestion before creating the Product
 * Master mapping that makes future sales reportable.
 */
export function buildUnmappedProductSales(rows: YtdRawRow[], products: ProductRow[]): UnmappedProductSalesRow[] {
  // Keep this exactly aligned with the mapped-sales transforms: a Product
  // record without a usable principal still cannot enter mapped dashboard
  // sales, so it must remain visible for review.
  const mappedItemCodes = new Set(products.filter((product) => product.principal.trim()).map((product) => product.itemNo));
  const byKey = new Map<string, UnmappedProductSalesRow>();

  for (const row of rows) {
    if (mappedItemCodes.has(row.itemCode)) continue;
    const warehouseCode = row.whsCode?.trim() ?? "";
    const monthIndex = row.monthNo - 1;
    const key = `${row.year}|${monthIndex}|${row.itemCode}|${warehouseCode}`;
    const existing = byKey.get(key) ?? {
      year: String(row.year),
      month: CANONICAL_MONTHS[monthIndex],
      monthIndex,
      itemNo: row.itemCode,
      itemDescription: row.brand.trim() || "(Unspecified product)",
      warehouseCode,
      revenue: 0,
      grossMargin: 0,
      quantity: 0,
    };
    existing.revenue += row.salesAmount;
    existing.grossMargin += row.grossMargin;
    existing.quantity += row.qtySold;
    byKey.set(key, existing);
  }

  return Array.from(byKey.values());
}

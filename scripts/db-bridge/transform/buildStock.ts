// Replicates Stock_Balance's post-SQL M-code transformation chain: join Products
// (item -> principal/pack size) and Warehouses (warehouse -> location), default a
// missing Location to "Nairobi", build the composite "Principal-Location" key,
// apply ONLY the Tropikal fixup (confirmed different from YTD_Raw's fixup list —
// see transform/buildMonthlySales.ts), join Principals, then collapse to
// Principal+Item grain (DAX: Opening Volume = SUM(Cartons), Opening Stock Pcs =
// SUM(Onhand/Available Qty), Opening Value = SUM(Stock Value)).
//
// Deliberately does NOT compute rrWeekValue/rrWeekVolume/daysCover/action — those
// need SAP_Raw's weekly-cases run-rate (a separate DAX calc, out of scope this
// round). Producing 0s here would make lib/parseWorkbook.ts's stockStatus()
// wrongly read every row as "Out of Stock", so these fields are left out of the
// output type entirely and the comparison script must label them accordingly
// rather than treat a missing value as zero.
import type { StockItem } from "@/lib/types";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { StockBalanceRow } from "../queries/stockBalance";
import type { ProductRow } from "../reference/loadFromDb";
import type { WarehouseRow, PrincipalRow } from "./buildMonthlySales";

export type PartialStockItem = Omit<StockItem, "rrWeekValue" | "rrWeekVolume" | "daysCover" | "action">;

const STOCK_BALANCE_FIXUPS: [string, string][] = [["Tropikal-Machakos", "Tropikal-Nairobi"]];

function applyFixups(key: string): string {
  for (const [from, to] of STOCK_BALANCE_FIXUPS) {
    if (key === from) return to;
  }
  return key;
}

export function buildStock(
  stockRows: StockBalanceRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[]
): { items: PartialStockItem[] } {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));
  const activePrincipalByKey = new Map(
    principals.filter((p) => p.status === "Active").map((p) => [p.principal, p])
  );

  interface Agg {
    principal: string;
    item: string;
    openingVolume: number;
    openingPcs: number;
    openingValue: number;
  }
  const byKey = new Map<string, Agg>();

  for (const row of stockRows) {
    const product = productByItemNo.get(row.itemCode);
    if (!product || !product.principal) continue;

    const warehouse = row.whsCode ? warehouseByCode.get(row.whsCode) : undefined;
    const location = warehouse?.location ?? "Nairobi";

    const rawKey = `${product.principal}-${location}`;
    const fixedKey = applyFixups(rawKey);

    const principalRow = activePrincipalByKey.get(fixedKey);
    if (!principalRow) continue;

    const cartons = product.packSize && product.packSize !== 0 ? row.onhandQty / product.packSize : null;

    const groupKey = `${principalRow.principal}|${row.itemName}`;
    let agg = byKey.get(groupKey);
    if (!agg) {
      agg = { principal: principalRow.principal, item: row.itemName, openingVolume: 0, openingPcs: 0, openingValue: 0 };
      byKey.set(groupKey, agg);
    }

    if (cartons !== null) agg.openingVolume += cartons;
    agg.openingPcs += row.onhandQty;
    agg.openingValue += row.stockValue;
  }

  const items: PartialStockItem[] = Array.from(byKey.values()).map((agg) => ({
    principal: agg.principal,
    key: normalizePrincipalKey(agg.principal),
    item: agg.item,
    openingVolume: agg.openingVolume,
    openingPcs: agg.openingPcs,
    openingValue: agg.openingValue,
  }));

  return { items };
}

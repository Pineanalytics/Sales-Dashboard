// Turns SAP document lines into the Performance Analysis lines: resolves each
// item to a principal with the same Product -> Principal / Warehouse -> Location
// chain SalesRecord uses (buildMonthlySales.ts), and holds closed-month gross
// profit to the figures the rest of the dashboard already shows.
//
// A line whose item maps to no Active principal is left out, exactly as
// SalesRecord leaves it out, so this report's sales tie to Sales Performance.
// The left-out amount is reported so it is never silent.
import type { PerfLine } from "@/lib/performanceAnalysis/types";
import type { PerformanceLineRow } from "../queries/performanceLines";
import type { ProductRow } from "../reference/loadFromDb";
import { applyFixups } from "./buildRepSales";
import type { PrincipalRow, WarehouseRow } from "./buildMonthlySales";

export interface BuiltPerformanceLines {
  lines: PerfLine[];
  /** Per line, the SalesRecord principal key (e.g. "EABL-Nyeri") used to hold closed-month GP; parallel to `lines`. */
  salesRecordKeys: string[];
  excludedSales: number;
  excludedLines: number;
}

/** Brand-level principal name: the main principal as named in the Principal table, with EABL's spelling unified. */
export function principalBrand(mainPrincipal: string): string {
  const name = mainPrincipal.trim();
  return name.toLowerCase() === "eabl" ? "EABL" : name;
}

const monthKeyOf = (year: number, monthNo: number) => `${year}-${String(monthNo).padStart(2, "0")}`;

export function buildPerformanceLines(
  rows: PerformanceLineRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[]
): BuiltPerformanceLines {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));
  const activePrincipalByKey = new Map(principals.filter((p) => p.status === "Active").map((p) => [p.principal, p]));

  const lines: PerfLine[] = [];
  const salesRecordKeys: string[] = [];
  let excludedSales = 0;
  let excludedLines = 0;

  for (const row of rows) {
    const product = productByItemNo.get(row.itemCode);
    const location = row.whsCode ? (warehouseByCode.get(row.whsCode)?.location ?? "Nairobi") : "Nairobi";
    const principalRow = product?.principal ? activePrincipalByKey.get(applyFixups(`${product.principal}-${location}`)) : undefined;
    if (!principalRow) {
      excludedSales += row.salesAmount;
      excludedLines += 1;
      continue;
    }
    lines.push({
      month: monthKeyOf(row.year, row.monthNo),
      doc: row.docType === "Credit Note" ? "credit" : "invoice",
      customerCode: row.customerCode,
      customerName: row.customerName,
      rep: row.sapName,
      principal: principalBrand(principalRow.mainPrincipal || principalRow.principal),
      itemCode: row.itemCode,
      itemName: row.itemName,
      warehouse: (row.whsCode ? warehouseByCode.get(row.whsCode)?.warehouseName : null) || row.whsCode || "(No warehouse)",
      // Same conversion as SalesRepActual: SAP Quantity is piece-denominated, so divide by the pack size.
      cases: row.packSize && row.packSize > 0 && Number.isFinite(row.qtySold) ? row.qtySold / row.packSize : 0,
      sales: row.salesAmount,
      gp: row.grossMargin,
    });
    salesRecordKeys.push(principalRow.principal);
  }
  return { lines, salesRecordKeys, excludedSales, excludedLines };
}

export interface StoredMonthTotals {
  revenue: number;
  grossProfit: number;
}

/** "YYYY-MM|SalesRecord principal" - the key `holdClosedMonthGp` reads stored totals by. */
export const storedTotalsKey = (month: string, salesRecordPrincipal: string) => `${month}|${salesRecordPrincipal}`;

/** The SAP query prices cost from TODAY's purchase price list, so re-reading a closed month re-costs it
 *  (see freezeClosedMonthCosts.ts). The dashboard keeps closed months at the margin they were stored with.
 *  For every closed (month, principal) that has a stored SalesRecord, this moves the GP of its lines
 *  so the group's margin equals the stored margin applied to the freshly read revenue. The shift is spread
 *  over the lines in proportion to their revenue, so item-to-item differences survive and the group total
 *  ties exactly. Returns how many (month, principal) groups were adjusted. */
export function holdClosedMonthGp(built: BuiltPerformanceLines, stored: Map<string, StoredMonthTotals>, asOfMonth: string): number {
  const groups = new Map<string, { revenue: number; gp: number; indexes: number[] }>();
  built.lines.forEach((line, index) => {
    if (line.month >= asOfMonth) return; // the current month is refreshed live and already ties
    const key = storedTotalsKey(line.month, built.salesRecordKeys[index]);
    const group = groups.get(key) ?? { revenue: 0, gp: 0, indexes: [] };
    group.revenue += line.sales;
    group.gp += line.gp;
    group.indexes.push(index);
    groups.set(key, group);
  });

  let adjusted = 0;
  for (const [key, group] of groups) {
    const record = stored.get(key);
    if (!record || record.revenue === 0 || group.revenue === 0) continue;
    const targetGp = group.revenue * (record.grossProfit / record.revenue);
    const shift = targetGp - group.gp;
    if (Math.abs(shift) < 0.5) continue;
    for (const index of group.indexes) built.lines[index].gp += shift * (built.lines[index].sales / group.revenue);
    adjusted += 1;
  }
  return adjusted;
}

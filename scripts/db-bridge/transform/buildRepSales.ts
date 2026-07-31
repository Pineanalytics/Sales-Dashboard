// Rep-grain companion to the existing principal-level SAP sales transforms.
// It follows the same Product -> Principal and Warehouse -> Location mapping,
// then resolves SAP salesperson names through the Employee Roaster master.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { DailySalesRawRow } from "../queries/dailySalesRaw";
import type { YtdRawRow } from "../queries/ytdRaw";
import type { EmployeeMasterReferenceRow, ProductRow } from "../reference/loadFromDb";
import type { PrincipalRow, WarehouseRow } from "./buildMonthlySales";

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

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ResolvedRep {
  employeeCode: string | null;
  employeeName: string | null;
}

function resolveRepBySapName(employees: EmployeeMasterReferenceRow[]): (sapName: string) => ResolvedRep {
  const bySapName = new Map<string, ResolvedRep | null>();
  for (const employee of employees) {
    const key = normalizeName(employee.sapName);
    if (!key) continue;
    if (bySapName.has(key)) {
      // A duplicate SAP name is not safe to guess. Keep the sales row, flagged
      // as unmatched, until the Employee Roaster resolves the duplicate.
      bySapName.set(key, null);
    } else {
      bySapName.set(key, { employeeCode: employee.employeeCode, employeeName: employee.pineName });
    }
  }
  return (sapName) => bySapName.get(normalizeName(sapName)) ?? { employeeCode: null, employeeName: null };
}

interface CommonRepSalesRow {
  date?: string;
  year?: string;
  month?: string;
  monthIndex?: number;
  location: string;
  principal: string;
  sapName: string;
  employeeCode: string | null;
  employeeName: string | null;
  volume: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

export type MonthlyRepSalesRow = Required<Pick<CommonRepSalesRow, "year" | "month" | "monthIndex">> & Omit<CommonRepSalesRow, "date" | "year" | "month" | "monthIndex">;
export type DailyRepSalesRow = Required<Pick<CommonRepSalesRow, "date">> & Omit<CommonRepSalesRow, "date" | "year" | "month" | "monthIndex">;

function masterMaps(products: ProductRow[], warehouses: WarehouseRow[], principals: PrincipalRow[]) {
  return {
    productByItemNo: new Map(products.map((p) => [p.itemNo, p])),
    warehouseByCode: new Map(warehouses.map((w) => [w.warehouseCode, w])),
    activePrincipalByKey: new Map(principals.filter((p) => p.status === "Active").map((p) => [p.principal, p])),
  };
}

export function buildMonthlyRepSales(
  rows: YtdRawRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[],
  employees: EmployeeMasterReferenceRow[]
): MonthlyRepSalesRow[] {
  const { productByItemNo, warehouseByCode, activePrincipalByKey } = masterMaps(products, warehouses, principals);
  const resolveRep = resolveRepBySapName(employees);
  const byKey = new Map<string, MonthlyRepSalesRow>();

  for (const row of rows) {
    if (row.period !== "YTD") continue;
    const product = productByItemNo.get(row.itemCode);
    if (!product?.principal) continue;
    const location = row.whsCode ? warehouseByCode.get(row.whsCode)?.location ?? "Nairobi" : "Nairobi";
    const principal = activePrincipalByKey.get(applyFixups(`${product.principal}-${location}`));
    if (!principal) continue;

    const rep = resolveRep(row.sapName);
    const key = `${row.year}|${row.monthNo}|${principal.principal}|${normalizeName(row.sapName)}`;
    const existing = byKey.get(key) ?? {
      year: String(row.year),
      month: CANONICAL_MONTHS[row.monthNo - 1],
      monthIndex: row.monthNo - 1,
      location: principal.location,
      principal: principal.principal,
      sapName: row.sapName,
      ...rep,
      volume: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
    };
    existing.volume += row.qtySold;
    existing.revenue += row.salesAmount;
    existing.cogs += row.cogs;
    existing.grossProfit += row.grossMargin;
    byKey.set(key, existing);
  }
  return Array.from(byKey.values());
}

export function buildDailyRepSales(
  rows: DailySalesRawRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[],
  employees: EmployeeMasterReferenceRow[]
): DailyRepSalesRow[] {
  const { productByItemNo, warehouseByCode, activePrincipalByKey } = masterMaps(products, warehouses, principals);
  const resolveRep = resolveRepBySapName(employees);
  const byKey = new Map<string, DailyRepSalesRow>();

  for (const row of rows) {
    const product = productByItemNo.get(row.itemCode);
    if (!product?.principal) continue;
    const location = row.whsCode ? warehouseByCode.get(row.whsCode)?.location ?? "Nairobi" : "Nairobi";
    const principal = activePrincipalByKey.get(applyFixups(`${product.principal}-${location}`));
    if (!principal) continue;

    const rep = resolveRep(row.sapName);
    const key = `${row.date}|${principal.principal}|${normalizeName(row.sapName)}`;
    const existing = byKey.get(key) ?? {
      date: row.date,
      location: principal.location,
      principal: principal.principal,
      sapName: row.sapName,
      ...rep,
      volume: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
    };
    existing.volume += row.qtySold;
    existing.revenue += row.salesAmount;
    existing.cogs += row.cogs;
    existing.grossProfit += row.grossMargin;
    byKey.set(key, existing);
  }
  return Array.from(byKey.values());
}

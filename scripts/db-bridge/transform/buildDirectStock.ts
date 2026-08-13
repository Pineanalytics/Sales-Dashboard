// Combines SAP physical inventory (OINM) with SAP demand (OINV/ORIN) into the
// precise Principal x Item grain consumed by the dashboard's Stock view. Excel
// remains authoritative until Admin accepts the recorded reconciliation.
import { stockStatus, weightedCoverDays } from "@/lib/parseWorkbook";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { StockItem } from "@/lib/types";
import type { StockBalanceRow } from "../queries/stockBalance";
import type { StandardStockDemandRow } from "../queries/standardStock";
import type { ProductRow } from "../reference/loadFromDb";
import type { PrincipalRow, WarehouseRow } from "./buildMonthlySales";

export interface DirectStockBuildResult {
  items: Array<StockItem & { itemCode: string }>;
  matchedDemandRows: number;
}

const STOCK_BALANCE_FIXUPS: ReadonlyArray<readonly [string, string]> = [["Tropikal-Machakos", "Tropikal-Nairobi"]];

function applyStockFixups(principal: string): string {
  return STOCK_BALANCE_FIXUPS.find(([from]) => principal === from)?.[1] ?? principal;
}

function midnightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Sundays are excluded, matching the current Standard Stock query's selling
 * calendar. Public-holiday exclusions remain intentionally empty until they are
 * supplied as an authoritative maintained list rather than guessed in code. */
function sellingDaysFrom(start: Date, end: Date): number {
  let count = 0;
  const cursor = midnightUtc(start);
  const finish = midnightUtc(end);
  while (cursor <= finish) {
    if (cursor.getUTCDay() !== 0) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

interface Demand {
  rrWeekValue: number;
  rrWeekVolume: number;
}

/** Direct equivalent of the Standard Stock M query's YTD run-rate steps. */
function buildDemandIndex(rows: StandardStockDemandRow[], startDate: Date, endDate: Date): Map<string, Demand> {
  const allSellingDays = sellingDaysFrom(startDate, endDate);
  const index = new Map<string, Demand>();
  for (const row of rows) {
    const demandDays = row.firstSale > startDate ? sellingDaysFrom(row.firstSale, endDate) : allSellingDays;
    if (demandDays <= 0) continue;
    index.set(`${row.itemCode}|${row.warehouseCode}`, {
      rrWeekValue: (Math.max(0, row.salesValue) / demandDays) * 7,
      rrWeekVolume: (Math.max(0, row.quantityUnits) / demandDays) * 7,
    });
  }
  return index;
}

export function buildDirectStock(
  stockRows: StockBalanceRow[],
  demandRows: StandardStockDemandRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[],
  asOfDate: Date
): DirectStockBuildResult {
  const productByItemCode = new Map(products.map((product) => [product.itemNo, product]));
  const warehouseByCode = new Map(warehouses.map((warehouse) => [warehouse.warehouseCode, warehouse]));
  const principalByName = new Map(principals.map((principal) => [principal.principal, principal]));
  const startDate = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1));
  const demandByItemWarehouse = buildDemandIndex(demandRows, startDate, asOfDate);

  interface Aggregate {
    principal: string;
    item: string;
    itemCode: string;
    openingVolume: number;
    openingPcs: number;
    openingValue: number;
    rrWeekValue: number;
    rrWeekVolume: number;
    matchedDemand: boolean;
  }

  const byPrincipalItem = new Map<string, Aggregate>();
  for (const row of stockRows) {
    const product = productByItemCode.get(row.itemCode);
    if (!product?.principal) continue;
    const location = (row.whsCode ? warehouseByCode.get(row.whsCode)?.location : undefined) ?? "Nairobi";
    const principalName = applyStockFixups(`${product.principal}-${location}`);
    const principal = principalByName.get(principalName);
    if (!principal) continue;

    const key = `${principal.principal}|${row.itemName}`;
    const demand = row.whsCode ? demandByItemWarehouse.get(`${row.itemCode}|${row.whsCode}`) : undefined;
    let aggregate = byPrincipalItem.get(key);
    if (!aggregate) {
      aggregate = {
        principal: principal.principal,
        item: row.itemName,
        itemCode: row.itemCode,
        openingVolume: 0,
        openingPcs: 0,
        openingValue: 0,
        rrWeekValue: 0,
        rrWeekVolume: 0,
        matchedDemand: false,
      };
      byPrincipalItem.set(key, aggregate);
    }
    if (product.packSize && product.packSize !== 0) aggregate.openingVolume += row.onhandQty / product.packSize;
    aggregate.openingPcs += row.onhandQty;
    aggregate.openingValue += row.stockValue;
    if (demand) {
      aggregate.rrWeekValue += demand.rrWeekValue;
      aggregate.rrWeekVolume += product.packSize && product.packSize !== 0 ? demand.rrWeekVolume / product.packSize : 0;
      aggregate.matchedDemand = true;
    }
  }

  // A SKU can have sales demand before its first stock movement in the current
  // warehouse history (or a warehouse row may not yet exist in OITW). Keep it
  // visible as a zero-stock item rather than silently losing the order signal.
  for (const demandRow of demandRows) {
    const product = productByItemCode.get(demandRow.itemCode);
    if (!product?.principal) continue;
    const location = warehouseByCode.get(demandRow.warehouseCode)?.location ?? "Nairobi";
    const principalName = applyStockFixups(`${product.principal}-${location}`);
    const principal = principalByName.get(principalName);
    if (!principal) continue;
    const key = `${principal.principal}|${demandRow.itemName}`;
    if (byPrincipalItem.has(key)) continue;
    const demand = demandByItemWarehouse.get(`${demandRow.itemCode}|${demandRow.warehouseCode}`);
    if (!demand) continue;
    byPrincipalItem.set(key, {
      principal: principal.principal,
      item: demandRow.itemName,
      itemCode: demandRow.itemCode,
      openingVolume: 0,
      openingPcs: 0,
      openingValue: 0,
      rrWeekValue: demand.rrWeekValue,
      rrWeekVolume: product.packSize && product.packSize !== 0 ? demand.rrWeekVolume / product.packSize : 0,
      matchedDemand: true,
    });
  }

  const aggregates = Array.from(byPrincipalItem.values());
  return {
    matchedDemandRows: aggregates.filter((row) => row.matchedDemand).length,
    items: aggregates.map((row) => {
      const daysCover = weightedCoverDays(row.openingValue, row.rrWeekValue);
      return {
        itemCode: row.itemCode,
        principal: row.principal,
        key: normalizePrincipalKey(row.principal),
        item: row.item,
        openingVolume: row.openingVolume,
        openingPcs: row.openingPcs,
        openingValue: row.openingValue,
        rrWeekValue: row.rrWeekValue,
        rrWeekVolume: row.rrWeekVolume,
        daysCover,
        action: stockStatus(daysCover, row.openingValue, row.rrWeekValue),
      };
    }),
  };
}

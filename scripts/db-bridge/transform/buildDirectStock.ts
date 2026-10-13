// Combines SAP physical inventory (OINM) with SAP demand (OINV/ORIN) into the
// precise Principal x Item grain consumed by the dashboard's Stock view. Excel
// remains authoritative until Admin accepts the recorded reconciliation.
import { stockStatus, weightedCoverDays } from "@/lib/parseWorkbook";
import { median3 } from "@/lib/standardStock";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { StockItem } from "@/lib/types";
import type { StockBalanceRow } from "../queries/stockBalance";
import type { LastSaleByItemRow, RecentActiveSaleRow, RecentDemandRow, StandardStockDemandRow } from "../queries/standardStock";
import type { ProductRow } from "../reference/loadFromDb";
import type { PrincipalRow, WarehouseRow } from "./buildMonthlySales";

export interface DirectStockBuildResult {
  items: Array<StockItem & { itemCode: string; rr4wValue: number | null; rr13wValue: number | null; stdRrWeekValue: number | null; stdRrWeekPcs: number | null }>;
  dormantItems: Array<{ principal: string; item: string; itemCode: string; openingPcs: number; openingValue: number; lastSaleDate: Date | null }>;
  matchedDemandRows: number;
}

const STOCK_BALANCE_FIXUPS: ReadonlyArray<readonly [string, string]> = [["Tropikal-Machakos", "Tropikal-Nairobi"]];

function applyStockFixups(principal: string): string {
  return STOCK_BALANCE_FIXUPS.find(([from]) => principal === from)?.[1] ?? principal;
}

function midnightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** SAP aggregate outputs should be numeric, but a null/invalid source value
 * must never turn into JSON `null` via NaN and reject the entire complete
 * snapshot. A non-finite operational measure has the conservative meaning 0;
 * the source row remains visible for reconciliation instead of disappearing. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  /** Year-to-date weekly run rate in pieces (before the pack-size division rrWeekVolume carries). */
  rrWeekPcs: number;
  firstSale: Date;
}

/** Selling days (Sundays excluded) in the last `windowDays` calendar days up to `asOf`, counted from the item's first sale when that
 *  is later, so a new SKU is measured over the days it could have sold. */
function recentSellingDays(asOf: Date, windowDays: number, firstSale: Date | undefined): number {
  const windowStart = midnightUtc(asOf);
  windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));
  const start = firstSale && midnightUtc(firstSale) > windowStart ? midnightUtc(firstSale) : windowStart;
  return sellingDaysFrom(start, asOf);
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
      rrWeekPcs: (Math.max(0, row.quantityUnits) / demandDays) * 7,
      firstSale: row.firstSale,
    });
  }
  return index;
}

function threeMonthsBefore(date: Date): Date {
  const result = midnightUtc(date);
  result.setUTCMonth(result.getUTCMonth() - 3);
  return result;
}

export function buildDirectStock(
  stockRows: StockBalanceRow[],
  demandRows: StandardStockDemandRow[],
  recentSalesRows: RecentActiveSaleRow[],
  products: ProductRow[],
  warehouses: WarehouseRow[],
  principals: PrincipalRow[],
  asOfDate: Date,
  /** The all-history last invoice date per item. Optional: without it the extract's inactivity columns are blank. */
  lastSaleByItem: LastSaleByItemRow[] = [],
  /** Demand over the last 28 / 91 days. Null when it was not read (the standard run rate then falls back to year to date). */
  recentDemandRows: RecentDemandRow[] | null = null
): DirectStockBuildResult {
  const recentDemandByItemWarehouse = recentDemandRows ? new Map(recentDemandRows.map((row) => [`${row.itemCode}|${row.warehouseCode}`, row])) : null;
  const allTimeLastSale = new Map(lastSaleByItem.map((row) => [row.itemCode, midnightUtc(row.lastSaleDate)]));
  const productByItemCode = new Map(products.map((product) => [product.itemNo, product]));
  const warehouseByCode = new Map(warehouses.map((warehouse) => [warehouse.warehouseCode, warehouse]));
  const principalByName = new Map(principals.map((principal) => [principal.principal, principal]));
  const startDate = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1));
  const demandByItemWarehouse = buildDemandIndex(demandRows, startDate, asOfDate);
  const recentSaleByItemWarehouse = new Map(recentSalesRows.map((row) => [`${row.itemCode}|${row.warehouseCode}`, midnightUtc(row.lastSaleDate)]));
  const dormantCutoff = threeMonthsBefore(asOfDate);

  interface Aggregate {
    principal: string;
    item: string;
    itemCode: string;
    brand: string | null;
    openingVolume: number;
    openingPcs: number;
    openingValue: number;
    rrWeekValue: number;
    rrWeekVolume: number;
    lastSaleDate: Date | null;
    /** Most recent invoice of any of the item's codes, across all history (not limited to the dormancy window). */
    lastSaleAny: Date | null;
    matchedDemand: boolean;
    /** Weekly run rates over the last 4 and 13 weeks, and year to date in pieces (summed over the item's warehouses). */
    rr4wValue: number;
    rr13wValue: number;
    rr4wPcs: number;
    rr13wPcs: number;
    rrYtdPcs: number;
  }

  /** The 4-week and 13-week weekly run rates of one item in one warehouse, in value and pieces; zero when it did not sell in the window. */
  const recentRates = (itemCode: string, warehouseCode: string, firstSale: Date | undefined) => {
    const recent = recentDemandByItemWarehouse?.get(`${itemCode}|${warehouseCode}`);
    const days28 = recentSellingDays(asOfDate, 28, firstSale);
    const days91 = recentSellingDays(asOfDate, 91, firstSale);
    return {
      rr4wValue: recent && days28 > 0 ? (Math.max(0, recent.value28) / days28) * 7 : 0,
      rr13wValue: recent && days91 > 0 ? (Math.max(0, recent.value91) / days91) * 7 : 0,
      rr4wPcs: recent && days28 > 0 ? (Math.max(0, recent.qty28) / days28) * 7 : 0,
      rr13wPcs: recent && days91 > 0 ? (Math.max(0, recent.qty91) / days91) * 7 : 0,
    };
  };

  const byPrincipalItem = new Map<string, Aggregate>();
  for (const row of stockRows) {
    const product = productByItemCode.get(row.itemCode);
    if (!product?.principal) continue;
    const location = (row.whsCode ? warehouseByCode.get(row.whsCode)?.location : undefined) ?? "Nairobi";
    const principalName = applyStockFixups(`${product.principal}-${location}`);
    const principal = principalByName.get(principalName);
    if (!principal) continue;

    // SAP permits a stock master record without an item name. The SKU is a
    // durable human-readable fallback and keeps that operational stock visible
    // rather than making the whole snapshot invalid.
    const item = row.itemName?.trim() || row.itemCode;
    const key = `${principal.principal}|${item}`;
    const demand = row.whsCode ? demandByItemWarehouse.get(`${row.itemCode}|${row.whsCode}`) : undefined;
    let aggregate = byPrincipalItem.get(key);
    if (!aggregate) {
      aggregate = {
        principal: principal.principal,
        item,
        itemCode: row.itemCode,
        brand: nullableText(row.brand),
        openingVolume: 0,
        openingPcs: 0,
        openingValue: 0,
        rrWeekValue: 0,
        rrWeekVolume: 0,
        lastSaleDate: null,
        lastSaleAny: null,
        matchedDemand: false,
        rr4wValue: 0,
        rr13wValue: 0,
        rr4wPcs: 0,
        rr13wPcs: 0,
        rrYtdPcs: 0,
      };
      byPrincipalItem.set(key, aggregate);
    }
    const everSold = allTimeLastSale.get(row.itemCode);
    if (everSold && (!aggregate.lastSaleAny || everSold > aggregate.lastSaleAny)) aggregate.lastSaleAny = everSold;
    if (product.packSize && product.packSize !== 0) aggregate.openingVolume += finite(row.onhandQty / product.packSize);
    aggregate.openingPcs += finite(row.onhandQty);
    aggregate.openingValue += finite(row.stockValue);
    const recentSale = row.whsCode ? recentSaleByItemWarehouse.get(`${row.itemCode}|${row.whsCode}`) ?? null : null;
    if (recentSale && (!aggregate.lastSaleDate || recentSale > aggregate.lastSaleDate)) aggregate.lastSaleDate = recentSale;
    if (demand) {
      aggregate.rrWeekValue += finite(demand.rrWeekValue);
      aggregate.rrWeekVolume += product.packSize && product.packSize !== 0 ? finite(demand.rrWeekVolume / product.packSize) : 0;
      aggregate.matchedDemand = true;
      aggregate.rrYtdPcs += finite(demand.rrWeekPcs);
    }
    if (row.whsCode && recentDemandByItemWarehouse) {
      const rates = recentRates(row.itemCode, row.whsCode, demand?.firstSale);
      aggregate.rr4wValue += rates.rr4wValue;
      aggregate.rr13wValue += rates.rr13wValue;
      aggregate.rr4wPcs += rates.rr4wPcs;
      aggregate.rr13wPcs += rates.rr13wPcs;
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
    const item = demandRow.itemName?.trim() || demandRow.itemCode;
    const key = `${principal.principal}|${item}`;
    if (byPrincipalItem.has(key)) continue;
    const demand = demandByItemWarehouse.get(`${demandRow.itemCode}|${demandRow.warehouseCode}`);
    if (!demand) continue;
    byPrincipalItem.set(key, {
      principal: principal.principal,
      item,
      itemCode: demandRow.itemCode,
      // No StockBalanceRow exists for this SKU (zero stock, demand-only) so
      // there is no SAP Brand/Manufacturer value to read here; overlayStock's
      // Product.series fallback is the only brand source for this row.
      brand: null,
      openingVolume: 0,
      openingPcs: 0,
      openingValue: 0,
      rrWeekValue: finite(demand.rrWeekValue),
      rrWeekVolume: product.packSize && product.packSize !== 0 ? finite(demand.rrWeekVolume / product.packSize) : 0,
      lastSaleDate: recentSaleByItemWarehouse.get(`${demandRow.itemCode}|${demandRow.warehouseCode}`) ?? null,
      lastSaleAny: allTimeLastSale.get(demandRow.itemCode) ?? null,
      matchedDemand: true,
      ...(recentDemandByItemWarehouse ? recentRates(demandRow.itemCode, demandRow.warehouseCode, demand.firstSale) : { rr4wValue: 0, rr13wValue: 0, rr4wPcs: 0, rr13wPcs: 0 }),
      rrYtdPcs: finite(demand.rrWeekPcs),
    });
  }

  const aggregates = Array.from(byPrincipalItem.values());
  const dormantItems = aggregates
    // The source workbook's SAP query excludes zero on-hand quantities. Use
    // physical pieces—not accounting valuation—to identify true stock-outs:
    // a free/zero-valued item still on hand must remain operational.
    // Dormant: no pieces on hand and no sale in three months, or stock on hand that has not moved: it has sold before but its
    // last invoice (all history) is older than three months and nothing sold in the window.
    .filter((row) => (row.openingPcs <= 0 && (!row.lastSaleDate || row.lastSaleDate < dormantCutoff)) || (row.openingPcs > 0 && !row.lastSaleDate && row.lastSaleAny !== null && row.lastSaleAny < dormantCutoff))
    .map((row) => ({ principal: row.principal, item: row.item, itemCode: row.itemCode, openingPcs: finite(row.openingPcs), openingValue: finite(row.openingValue), lastSaleDate: row.lastSaleAny ?? row.lastSaleDate }));
  const activeItems = aggregates.filter((row) => !dormantItems.some((dormant) => dormant.principal === row.principal && dormant.item === row.item));
  return {
    matchedDemandRows: activeItems.filter((row) => row.matchedDemand).length,
    dormantItems,
    items: activeItems.map((row) => {
      const openingVolume = finite(row.openingVolume);
      const openingPcs = finite(row.openingPcs);
      const openingValue = finite(row.openingValue);
      const rrWeekValue = finite(row.rrWeekValue);
      const rrWeekVolume = finite(row.rrWeekVolume);
      const daysCover = finite(weightedCoverDays(openingValue, rrWeekValue));
      // The standard run rate is the median of the 4-week, 13-week and year-to-date rates; null when the recent windows were not read.
      const standard = recentDemandByItemWarehouse !== null;
      return {
        rr4wValue: standard ? finite(row.rr4wValue) : null,
        rr13wValue: standard ? finite(row.rr13wValue) : null,
        stdRrWeekValue: standard ? finite(median3(row.rr4wValue, row.rr13wValue, rrWeekValue)) : null,
        stdRrWeekPcs: standard ? finite(median3(row.rr4wPcs, row.rr13wPcs, row.rrYtdPcs)) : null,
        itemCode: row.itemCode,
        principal: row.principal,
        key: normalizePrincipalKey(row.principal),
        item: row.item,
        brand: row.brand,
        openingVolume,
        openingPcs,
        openingValue,
        rrWeekValue,
        rrWeekVolume,
        daysCover,
        action: stockStatus(daysCover, row.openingValue, row.rrWeekValue),
        lastSaleDate: (row.lastSaleAny ?? row.lastSaleDate)?.toISOString().slice(0, 10) ?? null,
      };
    }),
  };
}

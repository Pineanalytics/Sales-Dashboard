import type { Dataset, StockTotal } from "./types";
import { weightedCoverDays, stockStatus } from "./parseWorkbook";
import { normalizePrincipalKey } from "./normalize";

export interface StockPrincipalRollup {
  key: string;
  name: string;
  volume: number;
  pcs: number;
  value: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  itemCount: number;
  outOfStockCount: number;
  runningOutCount: number;
  okCount: number;
  noDataCount: number;
  daysStock: number;
  action: string;
}

/** Groups item-level stock rows by normalized brand key, independent of how many
 *  regional "Principal" rows in Sales Vs Target share that key. */
export function aggregateStockByPrincipal(dataset: Dataset): StockPrincipalRollup[] {
  const byKey = new Map<string, StockPrincipalRollup>();

  for (const item of dataset.stockItems) {
    let agg = byKey.get(item.key);
    if (!agg) {
      agg = {
        key: item.key,
        name: item.principal.split("-")[0].trim(),
        volume: 0,
        pcs: 0,
        value: 0,
        rrWeekValue: 0,
        rrWeekVolume: 0,
        itemCount: 0,
        outOfStockCount: 0,
        runningOutCount: 0,
        okCount: 0,
        noDataCount: 0,
        daysStock: 0,
        action: "",
      };
      byKey.set(item.key, agg);
    }
    agg.volume += item.openingVolume;
    agg.pcs += item.openingPcs;
    agg.value += item.openingValue;
    agg.rrWeekValue += item.rrWeekValue;
    agg.rrWeekVolume += item.rrWeekVolume;
    agg.itemCount += 1;
    if (item.action.includes("\u{1F534}")) agg.outOfStockCount += 1;
    else if (item.action.includes("\u{1F7E1}")) agg.runningOutCount += 1;
    else if (item.action.includes("\u{1F7E2}")) agg.okCount += 1;
    else agg.noDataCount += 1;
  }

  const rollups = Array.from(byKey.values());
  for (const agg of rollups) {
    agg.daysStock = weightedCoverDays(agg.value, agg.rrWeekValue);
    agg.action = stockStatus(agg.daysStock, agg.value, agg.rrWeekValue);
  }
  return rollups;
}

/** Sums a subset of principal rollups back down to a StockTotal shape - used
 *  to recompute the portfolio KPI figures after excluding dormant principals,
 *  since dataset.stockTotal itself is a raw, unfiltered dataset-wide fact
 *  used elsewhere (e.g. Overview) and must not change meaning here. */
export function sumStockRollups(rollups: StockPrincipalRollup[]): StockTotal {
  const total: StockTotal = {
    volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0,
    daysStock: 0, itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "",
  };
  for (const r of rollups) {
    total.volume += r.volume;
    total.pcs += r.pcs;
    total.value += r.value;
    total.rrWeekValue += r.rrWeekValue;
    total.rrWeekVolume += r.rrWeekVolume;
    total.itemCount += r.itemCount;
    total.outOfStockCount += r.outOfStockCount;
    total.runningOutCount += r.runningOutCount;
    total.okCount += r.okCount;
    total.noDataCount += r.noDataCount;
  }
  total.daysStock = weightedCoverDays(total.value, total.rrWeekValue);
  total.action = stockStatus(total.daysStock, total.value, total.rrWeekValue);
  return total;
}

export interface StockBrandRollup {
  principalKey: string;
  principalName: string;
  /** Product Master's "series" field, or "Unspecified" for an item whose
   *  SAP code isn't in Product Master yet or has no series filled in. */
  brand: string;
  volume: number;
  pcs: number;
  value: number;
  rrWeekValue: number;
  itemCount: number;
  outOfStockCount: number;
  runningOutCount: number;
  noDataCount: number;
  daysStock: number;
  action: string;
}

/** Groups item-level stock rows by (principal, brand) - brand alone isn't
 *  guaranteed unique across principals, so this never merges two different
 *  principals' same-named series together. Pass `principalKey` to scope to
 *  one principal (matches aggregateStockByPrincipal's own key), or omit it
 *  for a brand breakdown across every principal at once. */
export function aggregateStockByBrand(dataset: Dataset, principalKey?: string | null): StockBrandRollup[] {
  const byKey = new Map<string, StockBrandRollup>();

  for (const item of dataset.stockItems) {
    if (principalKey && item.key !== principalKey) continue;
    const brand = item.brand?.trim() || "Unspecified";
    const groupKey = `${item.key}|${brand}`;
    let agg = byKey.get(groupKey);
    if (!agg) {
      agg = {
        principalKey: item.key,
        principalName: item.principal.split("-")[0].trim(),
        brand,
        volume: 0,
        pcs: 0,
        value: 0,
        rrWeekValue: 0,
        itemCount: 0,
        outOfStockCount: 0,
        runningOutCount: 0,
        noDataCount: 0,
        daysStock: 0,
        action: "",
      };
      byKey.set(groupKey, agg);
    }
    agg.volume += item.openingVolume;
    agg.pcs += item.openingPcs;
    agg.value += item.openingValue;
    agg.rrWeekValue += item.rrWeekValue;
    agg.itemCount += 1;
    if (item.action.includes("\u{1F534}")) agg.outOfStockCount += 1;
    else if (item.action.includes("\u{1F7E1}")) agg.runningOutCount += 1;
    else if (!item.action.includes("\u{1F7E2}")) agg.noDataCount += 1;
  }

  const rollups = Array.from(byKey.values());
  for (const agg of rollups) {
    agg.daysStock = weightedCoverDays(agg.value, agg.rrWeekValue);
    agg.action = stockStatus(agg.daysStock, agg.value, agg.rrWeekValue);
  }
  return rollups;
}

// Newly onboarded principals with little or no sales history yet - not dead
// accounts, just early. Exempt from dormancy regardless of recent revenue so
// they aren't wrongly buried in Dormant Stock the moment they're added.
const EMERGING_PRINCIPAL_KEYS = new Set(["Energia", "EFL", "Bennet", "Milly Fruits"].map(normalizePrincipalKey));

const DORMANT_SALES_WINDOW_MONTHS = 3;

export interface StockDormancyResult {
  dormantKeys: Set<string>;
  activeKeys: Set<string>;
}

/** A principal counts as commercially dormant when it has zero recorded
 *  Sales revenue across the most recent three (year, monthIndex) periods
 *  actually present in dataset.monthlySales - not the last three calendar
 *  months by wall-clock date, since a dataset can legitimately lag behind
 *  "today". Mirrors DormantStockActual's own three-month no-activity
 *  convention (see its schema comment), just applied per principal instead
 *  of per SKU, so "dormant" means the same thing in both places. */
export function classifyDormantPrincipals(dataset: Dataset, principalKeys: Iterable<string>): StockDormancyResult {
  const periods = Array.from(new Set(dataset.monthlySales.map((r) => `${r.year}|${r.monthIndex}`)))
    .sort()
    .slice(-DORMANT_SALES_WINDOW_MONTHS);
  const periodSet = new Set(periods);

  const revenueByKey = new Map<string, number>();
  for (const row of dataset.monthlySales) {
    if (!periodSet.has(`${row.year}|${row.monthIndex}`)) continue;
    revenueByKey.set(row.principalKey, (revenueByKey.get(row.principalKey) ?? 0) + row.revenue);
  }

  const dormantKeys = new Set<string>();
  const activeKeys = new Set<string>();
  for (const key of principalKeys) {
    if (EMERGING_PRINCIPAL_KEYS.has(key)) {
      activeKeys.add(key);
      continue;
    }
    if ((revenueByKey.get(key) ?? 0) > 0) activeKeys.add(key);
    else dormantKeys.add(key);
  }
  return { dormantKeys, activeKeys };
}

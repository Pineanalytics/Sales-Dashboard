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

/** No existing stock status tier flags an *excess* — OK/Running Out/Out of
 *  Stock/No Sales Data all skew toward shortage. This is a new threshold,
 *  not a value carried in the source data: an item counts as overstocked
 *  once its cover exceeds this many days, provided it still has a real run
 *  rate to measure against (a zero-run-rate item is "No Sales Data" risk,
 *  a different problem, not overstock). Shared by Executive Summary's Stock
 *  Risk KPI card and Stock Balance's own "Overstocked" tab, so the two never
 *  disagree on the definition. */
export const OVERSTOCK_DAYS_THRESHOLD = 60;

export interface OverstockSummary {
  itemCount: number;
  value: number;
}

export function isOverstocked(item: { rrWeekValue: number; daysCover: number }, thresholdDays: number = OVERSTOCK_DAYS_THRESHOLD): boolean {
  return item.rrWeekValue > 0 && item.daysCover > thresholdDays;
}

/** Overstock count/value across `dataset.stockItems`, optionally scoped to
 *  one normalized principal key (matches StockItem.key). Pass null for the
 *  company-wide total. */
export function computeOverstock(dataset: Dataset, principalKey: string | null, thresholdDays: number = OVERSTOCK_DAYS_THRESHOLD): OverstockSummary {
  let itemCount = 0;
  let value = 0;
  for (const item of dataset.stockItems) {
    if (principalKey && item.key !== principalKey) continue;
    if (!isOverstocked(item, thresholdDays)) continue;
    itemCount += 1;
    value += item.openingValue;
  }
  return { itemCount, value };
}

export interface PrincipalOverstock {
  key: string;
  name: string;
  itemCount: number;
  value: number;
}

/** Per-principal overstock breakdown, sorted by value descending, for a
 *  "worst offenders" table. Principal display name mirrors this file's own
 *  convention (the part of the Principal string before its location suffix,
 *  e.g. "EABL-Nyeri" -> "EABL"). */
export function computeOverstockByPrincipal(dataset: Dataset, thresholdDays: number = OVERSTOCK_DAYS_THRESHOLD): PrincipalOverstock[] {
  const byKey = new Map<string, PrincipalOverstock>();
  for (const item of dataset.stockItems) {
    if (!isOverstocked(item, thresholdDays)) continue;
    let agg = byKey.get(item.key);
    if (!agg) {
      agg = { key: item.key, name: item.principal.split("-")[0].trim(), itemCount: 0, value: 0 };
      byKey.set(item.key, agg);
    }
    agg.itemCount += 1;
    agg.value += item.openingValue;
  }
  return Array.from(byKey.values()).sort((a, b) => b.value - a.value);
}

// Newly onboarded principals with little or no sales history yet - not dead
// accounts, just early. Exempt from dormancy regardless of recent revenue so
// they aren't wrongly buried in Dormant Stock the moment they're added.
const EMERGING_PRINCIPAL_KEYS = new Set(["Energia", "EFL", "Bennet", "Milly Fruits"].map(normalizePrincipalKey));

const DORMANT_SALES_WINDOW_MONTHS = 3;

export interface StockDormancyResult {
  /** Every principal left out of the operational Stock Balance: flagged ones plus those with no recent sales. */
  dormantKeys: Set<string>;
  activeKeys: Set<string>;
  /** The subset of dormantKeys an admin flagged (Principal.stockDormant), whatever their recent sales. */
  flaggedKeys: Set<string>;
}

/** The brand keys an admin has flagged as dormant for stock. Stock is grouped by brand (the part of the principal
 *  name before its location, e.g. "Weetabix" for both Weetabix-Nairobi and Weetabix-Machakos), so a brand counts as
 *  dormant only when EVERY one of its principal rows is flagged: flagging one location of a live brand must not bury
 *  the whole brand's stock. */
export function dormantBrandKeysFromPrincipals(principals: { principal: string; stockDormant: boolean }[]): string[] {
  const byKey = new Map<string, { flagged: number; total: number }>();
  for (const row of principals) {
    const key = normalizePrincipalKey(row.principal);
    if (!key) continue;
    const entry = byKey.get(key) ?? { flagged: 0, total: 0 };
    entry.total += 1;
    if (row.stockDormant) entry.flagged += 1;
    byKey.set(key, entry);
  }
  return Array.from(byKey.entries())
    .filter(([, entry]) => entry.flagged === entry.total)
    .map(([key]) => key)
    .sort();
}

/** When each dormant brand was recorded as dormant (YYYY-MM-DD): the earliest date among its flagged principal rows, for brands
 *  that are dormant as a whole. Brands whose start date was never entered are left out. */
export function dormantSinceByBrandKey(principals: { principal: string; stockDormant: boolean; stockDormantSince: Date | null }[]): Record<string, string> {
  const dormant = new Set(dormantBrandKeysFromPrincipals(principals));
  const since: Record<string, string> = {};
  for (const row of principals) {
    if (!row.stockDormant || !row.stockDormantSince) continue;
    const key = normalizePrincipalKey(row.principal);
    if (!dormant.has(key)) continue;
    const date = row.stockDormantSince.toISOString().slice(0, 10);
    if (!since[key] || date < since[key]) since[key] = date;
  }
  return since;
}

/** A principal is dormant for stock when an admin has flagged it (a stopped principal still selling its leftover
 *  stock keeps showing sales, so sales alone cannot tell), or when it has zero recorded Sales revenue across the
 *  most recent three (year, monthIndex) periods actually present in dataset.monthlySales - not the last three
 *  calendar months by wall-clock date, since a dataset can legitimately lag behind "today". The three-month rule
 *  mirrors DormantStockActual's own no-activity convention (see its schema comment), just applied per principal
 *  instead of per SKU, so "dormant" means the same thing in both places. A flag outranks the emerging-principal
 *  exemption and any amount of recent revenue. */
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

  const flagged = new Set(dataset.dormantPrincipalKeys ?? []);
  const dormantKeys = new Set<string>();
  const activeKeys = new Set<string>();
  const flaggedKeys = new Set<string>();
  for (const key of principalKeys) {
    if (flagged.has(key)) {
      dormantKeys.add(key);
      flaggedKeys.add(key);
      continue;
    }
    if (EMERGING_PRINCIPAL_KEYS.has(key)) {
      activeKeys.add(key);
      continue;
    }
    if ((revenueByKey.get(key) ?? 0) > 0) activeKeys.add(key);
    else dormantKeys.add(key);
  }
  return { dormantKeys, activeKeys, flaggedKeys };
}

/** "Active" or "Inactive" per stock item's brand, for extracts that list all stock but must say which principals still
 *  operate. Inactive = dormant by the rule above. */
export function stockPrincipalStatuses(dataset: Dataset): Map<string, "Active" | "Inactive"> {
  const keys = Array.from(new Set(dataset.stockItems.map((item) => item.key)));
  const { dormantKeys } = classifyDormantPrincipals(dataset, keys);
  return new Map(keys.map((key) => [key, dormantKeys.has(key) ? "Inactive" : "Active"]));
}

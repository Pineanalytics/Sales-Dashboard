// Item-level Stock Balance: every figure on the page is built from the SKUs
// themselves. Brands are not well defined in SAP (its brand field is mostly the
// manufacturer), and a principal-level rollup pools fast and slow SKUs, so a
// status chip such as "Overstocked" now filters SKUs, and the totals, chart and
// tables all describe exactly the SKUs listed.
import { isOverstocked, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";
import { stockStatusFromCounts, weightedCoverDays } from "@/lib/parseWorkbook";
import type { StockItem } from "@/lib/types";

export type StockStatusFilter = "all" | "runningOut" | "outOfStock" | "overstocked" | "noData";

export const STOCK_STATUS_TABS: { key: StockStatusFilter; label: string }[] = [
  { key: "all", label: "All Stock" },
  { key: "runningOut", label: "Running Out" },
  { key: "outOfStock", label: "Out of Stock" },
  { key: "overstocked", label: "Overstocked" },
  { key: "noData", label: "No Sales Data" },
];

export function isStockStatusFilter(value: string | null): value is StockStatusFilter {
  return value !== null && STOCK_STATUS_TABS.some((tab) => tab.key === value);
}

type StatusFields = Pick<StockItem, "action" | "rrWeekValue" | "daysCover" | "overstockDays">;

/** Shortage (the item's own action) and excess cover (its overstock line) are separate axes, so an item can be both "OK" and overstocked. */
export function matchesStockStatus(item: StatusFields, filter: StockStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "runningOut") return item.action.includes("🟡");
  if (filter === "outOfStock") return item.action.includes("🔴");
  if (filter === "overstocked") return isOverstocked(item, OVERSTOCK_DAYS_THRESHOLD);
  return !item.action.includes("🔴") && !item.action.includes("🟡") && !item.action.includes("🟢");
}

export function stockStatusCounts(items: StatusFields[]): Record<StockStatusFilter, number> {
  const counts: Record<StockStatusFilter, number> = { all: items.length, runningOut: 0, outOfStock: 0, overstocked: 0, noData: 0 };
  for (const item of items) {
    for (const key of ["runningOut", "outOfStock", "overstocked", "noData"] as const) {
      if (matchesStockStatus(item, key)) counts[key] += 1;
    }
  }
  return counts;
}

export interface StockItemSummary {
  itemCount: number;
  value: number;
  volume: number;
  pcs: number;
  rrWeekValue: number;
  daysCover: number;
  standardValue: number;
  /** Stock value against standard stock, % (100 = exactly at standard); null when no standard applies. */
  vsStandardPct: number | null;
  outOfStockCount: number;
  runningOutCount: number;
  overstockedCount: number;
  noDataCount: number;
  /** The worst status among the items (lib/parseWorkbook.ts stockStatusFromCounts). */
  action: string;
}

export function summarizeStockItems(items: StockItem[]): StockItemSummary {
  let value = 0, volume = 0, pcs = 0, rrWeekValue = 0, standardValue = 0;
  for (const item of items) {
    value += item.openingValue;
    volume += item.openingVolume;
    pcs += item.openingPcs;
    rrWeekValue += item.rrWeekValue;
    standardValue += item.standardValue ?? 0;
  }
  const counts = stockStatusCounts(items);
  return {
    itemCount: items.length,
    value,
    volume,
    pcs,
    rrWeekValue,
    daysCover: weightedCoverDays(value, rrWeekValue),
    standardValue,
    vsStandardPct: standardValue > 0 ? (value / standardValue) * 100 : null,
    outOfStockCount: counts.outOfStock,
    runningOutCount: counts.runningOut,
    overstockedCount: counts.overstocked,
    noDataCount: counts.noData,
    action: stockStatusFromCounts(counts.outOfStock, counts.runningOut, items.length, counts.noData),
  };
}

export interface PrincipalItemSummary extends StockItemSummary {
  key: string;
  principal: string;
}

/** One row per principal, built only from the items given (e.g. just the overstocked ones), largest value first. */
export function summarizeStockItemsByPrincipal(items: StockItem[]): PrincipalItemSummary[] {
  const byKey = new Map<string, StockItem[]>();
  for (const item of items) {
    const list = byKey.get(item.key) ?? [];
    list.push(item);
    byKey.set(item.key, list);
  }
  return Array.from(byKey.entries())
    .map(([key, list]) => ({ key, principal: list[0].principal.split("-")[0].trim() || list[0].principal, ...summarizeStockItems(list) }))
    .sort((a, b) => b.value - a.value);
}

/** Case-insensitive search over item name, SAP item code and principal; every word must match. */
export function searchStockItems(items: StockItem[], query: string): StockItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const text = `${item.item} ${item.itemCode ?? ""} ${item.principal}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

import { describe, expect, it } from "vitest";
import { matchesStockStatus, searchStockItems, stockStatusCounts, summarizeStockItems, summarizeStockItemsByPrincipal, isStockStatusFilter } from "@/lib/stockItemView";
import type { StockItem } from "@/lib/types";

function item(overrides: Partial<StockItem>): StockItem {
  return {
    principal: "Suntory-Nairobi",
    key: "suntory",
    item: "Ribena 1L",
    itemCode: "SUN001",
    openingVolume: 10,
    openingPcs: 120,
    openingValue: 7000,
    rrWeekValue: 7000,
    rrWeekVolume: 10,
    daysCover: 7,
    action: "🟢 Sufficient",
    targetDays: 30,
    reorderDays: 14,
    overstockDays: 60,
    standardValue: 30000,
    ...overrides,
  };
}

const items: StockItem[] = [
  item({ item: "Ribena 1L", action: "🟢 Sufficient", daysCover: 90, rrWeekValue: 700, openingValue: 9000 }), // sufficient AND overstocked
  item({ item: "Lucozade 500ml", itemCode: "SUN002", action: "🟡 Running Out", daysCover: 5, openingValue: 2000 }),
  item({ item: "Lucozade 1L", itemCode: "SUN003", action: "🔴 Out of Stock", daysCover: 0, openingValue: 0, rrWeekValue: 3500 }),
  item({ principal: "Mars-Nairobi", key: "mars", item: "Snickers 50g", itemCode: "MARS01", action: "No Sales Data", rrWeekValue: 0, daysCover: 0, openingValue: 4000, standardValue: 0 }),
];

describe("item-level stock status", () => {
  it("filters SKUs by status, treating overstock as its own axis", () => {
    expect(items.filter((i) => matchesStockStatus(i, "overstocked")).map((i) => i.item)).toEqual(["Ribena 1L"]);
    expect(items.filter((i) => matchesStockStatus(i, "runningOut")).map((i) => i.item)).toEqual(["Lucozade 500ml"]);
    expect(items.filter((i) => matchesStockStatus(i, "outOfStock")).map((i) => i.item)).toEqual(["Lucozade 1L"]);
    expect(items.filter((i) => matchesStockStatus(i, "noData")).map((i) => i.item)).toEqual(["Snickers 50g"]);
    expect(stockStatusCounts(items)).toEqual({ all: 4, runningOut: 1, outOfStock: 1, overstocked: 1, noData: 1 });
  });

  it("uses each SKU's own overstock line", () => {
    expect(matchesStockStatus(item({ daysCover: 45, overstockDays: 40 }), "overstocked")).toBe(true);
    expect(matchesStockStatus(item({ daysCover: 45, overstockDays: 90 }), "overstocked")).toBe(false);
  });

  it("accepts only known ?status= values", () => {
    expect(isStockStatusFilter("overstocked")).toBe(true);
    expect(isStockStatusFilter("brand")).toBe(false);
    expect(isStockStatusFilter(null)).toBe(false);
  });
});

describe("summaries built from the listed SKUs", () => {
  it("totals value, cover and standard stock for exactly the SKUs given", () => {
    const overstocked = summarizeStockItems(items.filter((i) => matchesStockStatus(i, "overstocked")));
    expect(overstocked.itemCount).toBe(1);
    expect(overstocked.value).toBe(9000);
    expect(overstocked.daysCover).toBe(90);
    expect(overstocked.vsStandardPct).toBe(30);
    expect(overstocked.overstockedCount).toBe(1);
  });

  it("rolls the listed SKUs up per principal, largest value first", () => {
    const rows = summarizeStockItemsByPrincipal(items);
    expect(rows.map((r) => [r.principal, r.itemCount])).toEqual([["Suntory", 3], ["Mars", 1]]);
  });

  it("searches item name, SAP code and principal", () => {
    expect(searchStockItems(items, "lucozade 1l").map((i) => i.itemCode)).toEqual(["SUN003"]);
    expect(searchStockItems(items, "mars01").map((i) => i.item)).toEqual(["Snickers 50g"]);
    expect(searchStockItems(items, "  ")).toHaveLength(4);
  });
});

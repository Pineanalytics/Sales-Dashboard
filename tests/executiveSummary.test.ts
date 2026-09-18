import { describe, expect, it } from "vitest";
import { computeSalesRunRate, computeOverstock, computeOverstockByPrincipal, periodToDateRange } from "@/lib/executiveSummary";
import type { PeriodSalesSummary, PeriodSelection } from "@/lib/timeIntelligence";
import type { Dataset, StockItem } from "@/lib/types";

function salesSummary(overrides: Partial<PeriodSalesSummary>): PeriodSalesSummary {
  return {
    revenue: 0, target: null, cogs: 0, grossProfit: 0, grossMarginPct: null,
    achievementPct: null, monthsIncluded: 0, mtdTargetPacing: null,
    ...overrides,
  };
}

function stockItem(overrides: Partial<StockItem>): StockItem {
  return {
    principal: "Mars-Nairobi", key: "mars", item: "Widget", brand: null,
    openingVolume: 0, openingPcs: 0, openingValue: 0, rrWeekValue: 0, rrWeekVolume: 0,
    daysCover: 0, action: "⚪ No Sales Data",
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset>): Dataset {
  return {
    monthlySales: [], monthlyCoverage: [], monthlyBrandCustomer: [], monthlyPL: [],
    stockTotal: { volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0, itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "" },
    stockItems: [], reportMeta: { title: "", sheet: "" }, uploadedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeSalesRunRate", () => {
  it("uses live elapsed-days pacing for an in-progress MTD period", () => {
    const period: PeriodSelection = { kind: "MTD", year: "2026", month: "July" };
    const summary = salesSummary({ revenue: 70000, monthsIncluded: 1, mtdTargetPacing: { elapsedDays: 10, daysInMonth: 31, factor: 10 / 31 } });
    const rate = computeSalesRunRate(summary, period);
    expect(rate).not.toBeNull();
    expect(rate!.basis).toBe("live");
    expect(rate!.daily).toBeCloseTo(7000);
    expect(rate!.weekly).toBeCloseTo(49000);
    expect(rate!.monthly).toBeCloseTo(7000 * 31);
  });

  it("falls back to a monthly average for a non-MTD period like QTD/YTD", () => {
    const period: PeriodSelection = { kind: "YTD", year: "2026" };
    const summary = salesSummary({ revenue: 300000, monthsIncluded: 3 });
    const rate = computeSalesRunRate(summary, period);
    expect(rate).not.toBeNull();
    expect(rate!.basis).toBe("average");
    expect(rate!.monthly).toBeCloseTo(100000);
    expect(rate!.daily).toBeCloseTo(100000 / 30);
    expect(rate!.weekly).toBeCloseTo((100000 / 30) * 7);
  });

  it("returns null when there is no revenue-bearing month to pace from", () => {
    const period: PeriodSelection = { kind: "YTD", year: "2026" };
    const summary = salesSummary({ revenue: 0, monthsIncluded: 0 });
    expect(computeSalesRunRate(summary, period)).toBeNull();
  });
});

describe("computeOverstock / computeOverstockByPrincipal", () => {
  it("flags an item as overstocked only when it has both excess cover and a real run rate", () => {
    const ds = dataset({
      stockItems: [
        stockItem({ key: "mars", principal: "Mars-Nairobi", openingValue: 1000, rrWeekValue: 50, daysCover: 90 }),
        // High cover but zero run rate — "No Sales Data" risk, not overstock.
        stockItem({ key: "mars", principal: "Mars-Nairobi", openingValue: 2000, rrWeekValue: 0, daysCover: 500 }),
        // Real run rate but under the threshold — healthy.
        stockItem({ key: "durex", principal: "Durex-Nairobi", openingValue: 500, rrWeekValue: 100, daysCover: 20 }),
      ],
    });
    const overall = computeOverstock(ds, null);
    expect(overall.itemCount).toBe(1);
    expect(overall.value).toBe(1000);

    const marsOnly = computeOverstock(ds, "mars");
    expect(marsOnly.itemCount).toBe(1);
    expect(marsOnly.value).toBe(1000);

    const durexOnly = computeOverstock(ds, "durex");
    expect(durexOnly.itemCount).toBe(0);
  });

  it("ranks principals by overstocked value descending", () => {
    const ds = dataset({
      stockItems: [
        stockItem({ key: "mars", principal: "Mars-Nairobi", openingValue: 1000, rrWeekValue: 10, daysCover: 90 }),
        stockItem({ key: "durex", principal: "Durex-Nairobi", openingValue: 5000, rrWeekValue: 10, daysCover: 120 }),
        stockItem({ key: "durex", principal: "Durex-Nairobi", openingValue: 1500, rrWeekValue: 10, daysCover: 80 }),
      ],
    });
    const byPrincipal = computeOverstockByPrincipal(ds);
    expect(byPrincipal).toHaveLength(2);
    expect(byPrincipal[0]).toMatchObject({ key: "durex", itemCount: 2, value: 6500 });
    expect(byPrincipal[1]).toMatchObject({ key: "mars", itemCount: 1, value: 1000 });
  });

  it("respects a custom threshold", () => {
    const ds = dataset({
      stockItems: [stockItem({ key: "mars", openingValue: 1000, rrWeekValue: 10, daysCover: 45 })],
    });
    expect(computeOverstock(ds, null, 60).itemCount).toBe(0);
    expect(computeOverstock(ds, null, 30).itemCount).toBe(1);
  });
});

describe("periodToDateRange", () => {
  it("spans a single MONTH period's full calendar month", () => {
    const range = periodToDateRange({ kind: "MONTH", year: "2026", month: "February" });
    expect(range).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  });

  it("spans a multi-month period (QTD) from the first to the last month's last day", () => {
    const range = periodToDateRange({ kind: "QTD", year: "2026", month: "September" });
    expect(range).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-09-30" });
  });

  it("spans a full year for YTD through December", () => {
    const range = periodToDateRange({ kind: "YTD", year: "2026", month: "December" });
    expect(range).toEqual({ dateFrom: "2026-01-01", dateTo: "2026-12-31" });
  });
});

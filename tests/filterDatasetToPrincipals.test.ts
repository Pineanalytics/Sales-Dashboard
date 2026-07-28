import { describe, expect, it } from "vitest";
import { filterDatasetToPrincipals } from "../lib/datasetStore";
import type { Dataset } from "../lib/types";

function baseDataset(): Dataset {
  return {
    monthlySales: [
      { year: "2026", month: "July", monthIndex: 6, location: "Nairobi", principal: "Bic-Nairobi", principalKey: "bic", revenue: 100, target: 120, cogs: 60, grossProfit: 40, grossMarginPct: 40 },
      { year: "2026", month: "July", monthIndex: 6, location: "Nairobi", principal: "EFL-Nairobi", principalKey: "efl", revenue: 200, target: 220, cogs: 120, grossProfit: 80, grossMarginPct: 40 },
    ],
    monthlyCoverage: [
      { year: "2026", month: "July", monthIndex: 6, salesRole: "Primary Sales", employeeName: "Rep A", principal: "Bic-Nairobi", principalKey: "bic", coverage: 10, productiveCalls: 8, productivityPct: 80 },
      { year: "2026", month: "July", monthIndex: 6, salesRole: "Primary Sales", employeeName: "Rep B", principal: "EFL-Nairobi", principalKey: "efl", coverage: 5, productiveCalls: 4, productivityPct: 80 },
    ],
    monthlyBrandCustomer: [
      { year: "2026", month: "July", monthIndex: 6, principal: "Bic-Nairobi", principalKey: "bic", salesEmployee: "Rep A", customerName: "Shop 1", volume: 10, revenue: 100, grossProfit: 40, grossMarginPct: 40 },
      { year: "2026", month: "July", monthIndex: 6, principal: "EFL-Nairobi", principalKey: "efl", salesEmployee: "Rep B", customerName: "Shop 2", volume: 20, revenue: 200, grossProfit: 80, grossMarginPct: 40 },
    ],
    monthlyPL: [
      { year: "2026", month: "July", monthIndex: 6, principal: "Bic-Nairobi", principalKey: "bic", accountCode: "4000", accountName: "Sales", lineType: "REVENUE", amount: 100 },
      { year: "2026", month: "July", monthIndex: 6, principal: "EFL-Nairobi", principalKey: "efl", accountCode: "4000", accountName: "Sales", lineType: "REVENUE", amount: 200 },
    ],
    weeklyProjection: [
      { principal: "Bic-Nairobi", weeklyRevenue: 25, weeklyProjection: 30, weeklyRR: 25, weekVariance: -5, achievedProjectionPct: 83 },
      { principal: "EFL-Nairobi", weeklyRevenue: 50, weeklyProjection: 55, weeklyRR: 50, weekVariance: -5, achievedProjectionPct: 91 },
    ],
    stockTotal: {
      volume: 999,
      pcs: 999,
      value: 999,
      rrWeekValue: 999,
      rrWeekVolume: 999,
      daysStock: 99,
      itemCount: 2,
      outOfStockCount: 0,
      runningOutCount: 0,
      okCount: 2,
      noDataCount: 0,
      action: "stale-company-wide-total",
    },
    stockItems: [
      { principal: "Bic-Nairobi", key: "bic", item: "Item A", openingVolume: 10, openingPcs: 100, openingValue: 1000, rrWeekValue: 50, rrWeekVolume: 5, daysCover: 20, action: "\u{1F7E2} OK" },
      { principal: "EFL-Nairobi", key: "efl", item: "Item B", openingVolume: 20, openingPcs: 200, openingValue: 2000, rrWeekValue: 0, rrWeekVolume: 0, daysCover: 999, action: "\u{1F534} Out of Stock" },
    ],
    reportMeta: { title: "Test Report", sheet: "Test" },
    uploadedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("filterDatasetToPrincipals", () => {
  it("keeps only rows whose principalKey is in the allowed set, across every row-level array", () => {
    const result = filterDatasetToPrincipals(baseDataset(), new Set(["bic"]));
    expect(result.monthlySales).toHaveLength(1);
    expect(result.monthlySales[0].principal).toBe("Bic-Nairobi");
    expect(result.monthlyCoverage).toHaveLength(1);
    expect(result.monthlyCoverage[0].principal).toBe("Bic-Nairobi");
    expect(result.monthlyBrandCustomer).toHaveLength(1);
    expect(result.monthlyPL).toHaveLength(1);
    expect(result.weeklyProjection).toHaveLength(1);
    expect(result.stockItems).toHaveLength(1);
    expect(result.stockItems[0].item).toBe("Item A");
  });

  it("recomputes stockTotal from the filtered stockItems rather than leaving the stale company-wide total", () => {
    const result = filterDatasetToPrincipals(baseDataset(), new Set(["bic"]));
    expect(result.stockTotal.itemCount).toBe(1);
    expect(result.stockTotal.value).toBe(1000);
    expect(result.stockTotal.rrWeekValue).toBe(50);
    expect(result.stockTotal.okCount).toBe(1);
    expect(result.stockTotal.outOfStockCount).toBe(0);
    expect(result.stockTotal.action).not.toBe("stale-company-wide-total");
  });

  it("returns everything when every principal is in the allowed set", () => {
    const result = filterDatasetToPrincipals(baseDataset(), new Set(["bic", "efl"]));
    expect(result.monthlySales).toHaveLength(2);
    expect(result.stockItems).toHaveLength(2);
  });

  it("returns nothing when the allowed set matches no principal", () => {
    const result = filterDatasetToPrincipals(baseDataset(), new Set(["someone"]));
    expect(result.monthlySales).toHaveLength(0);
    expect(result.stockItems).toHaveLength(0);
    expect(result.stockTotal.itemCount).toBe(0);
    expect(result.stockTotal.value).toBe(0);
  });

  it("leaves reportMeta/uploadedAt and other non-row-level fields untouched", () => {
    const result = filterDatasetToPrincipals(baseDataset(), new Set(["bic"]));
    expect(result.reportMeta).toEqual({ title: "Test Report", sheet: "Test" });
    expect(result.uploadedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

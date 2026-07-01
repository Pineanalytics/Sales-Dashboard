import { describe, it, expect } from "vitest";
import { parseWorkbook, weightedCoverDays, stockStatus, WorkbookParseError } from "@/lib/parseWorkbook";
import { normalizePrincipalKey } from "@/lib/normalize";
import { buildFixtureWorkbook, salesVsTargetRows } from "./fixtures/buildWorkbook";

describe("normalizePrincipalKey", () => {
  it("lowercases, strips punctuation and takes the segment before the first dash", () => {
    expect(normalizePrincipalKey("Upfield-Nairobi")).toBe("upfield");
    expect(normalizePrincipalKey("EABL-Nyeri")).toBe("eabl");
  });

  it("collides regional principal rows onto the same brand key", () => {
    expect(normalizePrincipalKey("EABL-Nyeri")).toBe(normalizePrincipalKey("EABL-Nyahururu"));
  });
});

describe("stock status thresholds", () => {
  it("computes weighted cover days from value and weekly run-rate", () => {
    expect(weightedCoverDays(1000, 2000)).toBe(3.5);
    expect(weightedCoverDays(0, 2000)).toBe(0);
    expect(weightedCoverDays(1000, 0)).toBe(0);
  });

  it("flags out of stock when value is exhausted, regardless of days", () => {
    expect(stockStatus(50, 0, 500)).toContain("Out of Stock");
  });

  it("flags No Sales Data when run-rate is zero even with stock on hand", () => {
    expect(stockStatus(0, 500, 0)).toContain("No Sales Data");
  });

  it("flags out of stock below 7 days cover", () => {
    expect(stockStatus(3.5, 1000, 2000)).toContain("Out of Stock");
  });

  it("flags running out between 7 and 14 days cover", () => {
    expect(stockStatus(7, 1000, 1000)).toContain("Running Out");
  });

  it("flags OK at or above 14 days cover", () => {
    expect(stockStatus(35, 5000, 1000)).toContain("OK");
  });
});

describe("parseWorkbook", () => {
  const dataset = parseWorkbook(buildFixtureWorkbook(), "2026-06-30T00:00:00.000Z");

  it("extracts the report title from the rows above the header", () => {
    expect(dataset.reportMeta.title).toBe("JUNE 2026 MTD SALES VS TARGET & YTD ACTUALS");
  });

  it("converts sheet fractions to 1-decimal percentages", () => {
    const eabl = dataset.principals.find((p) => p.name === "EABL-Nyeri")!;
    expect(eabl.achFull).toBe(45);
    expect(eabl.achMTD).toBe(90);
    expect(eabl.mom).toBe(12.5);
    expect(eabl.yoy).toBe(28.6); // 0.2857 * 100 rounded to 1dp
    expect(eabl.grossMarginPct).toBe(12);
  });

  it("treats a zero/blank MTD target as no target set (achMTD = null)", () => {
    const weetabix = dataset.principals.find((p) => p.name === "Weetabix-Meru")!;
    expect(weetabix.mtdTarget).toBe(0);
    expect(weetabix.achMTD).toBeNull();
  });

  it("excludes the Total Sales row from principals and uses it for portfolio totals", () => {
    expect(dataset.principals.some((p) => p.name.toLowerCase().includes("total"))).toBe(false);
    expect(dataset.totals.mtdRev).toBe(102000);
  });

  it("keys multi-region principal rows to the same normalized stock key", () => {
    const nyeri = dataset.principals.find((p) => p.name === "EABL-Nyeri")!;
    const nyahururu = dataset.principals.find((p) => p.name === "EABL-Nyahururu")!;
    expect(nyeri.stockKey).toBe("eabl");
    expect(nyahururu.stockKey).toBe("eabl");
    // both share the same aggregated stock figures since they roll up to the same brand key
    expect(nyeri.stockValue).toBe(nyahururu.stockValue);
    expect(nyeri.stockValue).toBe(1000 + 5000 + 1000);
  });

  it("recomputes aggregate stock days/status rather than trusting per-row values", () => {
    const upfield = dataset.principals.find((p) => p.name === "Upfield-Nairobi")!;
    expect(upfield.stockValue).toBe(0);
    expect(upfield.stockAction).toContain("Out of Stock");
    expect(upfield.stockOutOfStockCount).toBe(1);

    const eabl = dataset.principals.find((p) => p.name === "EABL-Nyeri")!;
    // value=7000, rr=4000 -> days = 7000/4000*7 = 12.25, rounded to 1dp = 12.3
    expect(eabl.daysStock).toBeCloseTo(12.3, 5);
    expect(eabl.stockAction).toContain("Running Out");
    expect(eabl.stockItemCount).toBe(3);
    expect(eabl.stockOutOfStockCount).toBe(1);
    expect(eabl.stockRunningOutCount).toBe(1);
    expect(eabl.stockOkCount).toBe(1);
  });

  it("flags items with stock but no recent run-rate as No Sales Data, not OK", () => {
    const weetabix = dataset.principals.find((p) => p.name === "Weetabix-Meru")!;
    expect(weetabix.stockValue).toBe(900);
    expect(weetabix.stockAction).toContain("No Sales Data");
    expect(weetabix.stockNoDataCount).toBe(1);
    expect(weetabix.stockOkCount).toBe(0);
    expect(dataset.stockTotal.noDataCount).toBeGreaterThanOrEqual(1);
  });

  it("derives the current coverage month from the last monthly Total row, not by summing principal rows", () => {
    expect(dataset.coverageTrends.currentMonth).toBe("June");
    expect(dataset.covTotal.currentCoverage).toBe(290);
    expect(dataset.covTotal.currentProductiveCalls).toBe(253);
    expect(dataset.covTotal.currentProductivityPct).toBe(87.2);
    expect(dataset.covTotal.ytdCoverage).toBe(280); // from the "Average" row, not a sum of principals
  });

  it("scans the two-block Trended Revenue layout by label rather than fixed offsets", () => {
    expect(dataset.trendedRevenue.totals["2025"][0]).toBe(100000);
    expect(dataset.trendedRevenue.totals["2026"][0]).toBe(120000);
    expect(dataset.trendedRevenue.totals["2026"][6]).toBeNull(); // July 2026 not yet reached
    expect(dataset.trendedRevenue.yoy[0]).toBe(20);
    expect(dataset.trendedRevenue.yoy[6]).toBeNull();

    expect(dataset.trendedRevenue.byPrincipalKey["eabl"]["2025"][0]).toBe(60000);
    expect(dataset.trendedRevenue.byPrincipalKey["eabl"]["2026"][5]).toBe(85000);
    expect(dataset.trendedRevenue.byPrincipalKey["eabl"]["2026"][6]).toBeNull();
    expect(dataset.trendedRevenue.byPrincipalKey["upfield"]["2025"][0]).toBe(40000);
  });

  it("ignores explicit '<year> Total' rows in both Trended Revenue blocks", () => {
    expect(Object.keys(dataset.trendedRevenue.byPrincipalKey)).not.toContain("total");
  });

  it("skips the Weekly Projection total row and fills in achieved % when blank", () => {
    expect(dataset.weeklyProjection).toHaveLength(3);
    const nyahururu = dataset.weeklyProjection.find((r) => r.principal === "EABL-Nyahururu")!;
    expect(nyahururu.achievedProjectionPct).toBe(90); // 9000/10000*100, computed since the cell was blank
    const nyeri = dataset.weeklyProjection.find((r) => r.principal === "EABL-Nyeri")!;
    expect(nyeri.achievedProjectionPct).toBe(120); // 1.2 * 100 from the sheet
  });
});

describe("parseWorkbook validation", () => {
  it("throws a WorkbookParseError when a required sheet is missing", () => {
    const buffer = buildFixtureWorkbook({ omitSheet: "Stock Balances" });
    expect(() => parseWorkbook(buffer)).toThrow(WorkbookParseError);
  });
});

describe("header row detection is layout-tolerant", () => {
  it("finds the header whether there's a blank row above the title or not", () => {
    // Exports vary month to month — some have a blank row above the title, some don't.
    // The parser locates the header by content ("Principal" in column A), not a fixed index.
    const withBlankRow = buildFixtureWorkbook({
      sheetOverrides: { "Sales Vs Target": [[""], ...salesVsTargetRows] },
    });
    const dataset = parseWorkbook(withBlankRow);
    expect(dataset.reportMeta.title).toBe("JUNE 2026 MTD SALES VS TARGET & YTD ACTUALS");
    expect(dataset.totals.mtdRev).toBe(102000);
    expect(dataset.principals.find((p) => p.name === "EABL-Nyeri")?.mtdRev).toBe(45000);
  });
});

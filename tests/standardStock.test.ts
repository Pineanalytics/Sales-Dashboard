import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERSTOCK_DAYS,
  DEFAULT_REORDER_DAYS,
  DEFAULT_TARGET_DAYS,
  median3,
  resolveCoverThresholds,
  standardRunRate,
  standardStockFor,
  stockVsStandardPct,
  type CoverTargetRow,
} from "../lib/standardStock";
import { stockStatus } from "../lib/parseWorkbook";
import { aggregateStockByBrand, aggregateStockByPrincipal, isOverstocked } from "../lib/stock";
import type { Dataset, StockItem } from "../lib/types";

describe("median3", () => {
  it("returns the middle value whatever the order", () => {
    expect(median3(1, 2, 3)).toBe(2);
    expect(median3(3, 1, 2)).toBe(2);
    expect(median3(9, 9, 1)).toBe(9);
    expect(median3(0, 5, 100)).toBe(5);
  });
});

describe("standardRunRate", () => {
  it("is the median of the 4-week, 13-week and year-to-date rates", () => {
    expect(standardRunRate({ ytd: 100, last4w: 300, last13w: 120 })).toEqual({ rate: 120, basis: "standard" });
  });

  it("ignores a one-off spike in a single window", () => {
    // one huge order in the last 4 weeks: 4-week rate 1000, the other two windows agree on about 100
    expect(standardRunRate({ ytd: 100, last4w: 1000, last13w: 110 }).rate).toBe(110);
  });

  it("does not count a SKU that has just stopped selling at its old year-to-date pace", () => {
    expect(standardRunRate({ ytd: 500, last4w: 0, last13w: 40 }).rate).toBe(40);
  });

  it("follows a real change once two windows agree", () => {
    expect(standardRunRate({ ytd: 50, last4w: 200, last13w: 180 }).rate).toBe(180);
  });

  it("falls back to year to date when the recent windows are missing, and never goes negative", () => {
    expect(standardRunRate({ ytd: 70 })).toEqual({ rate: 70, basis: "ytd" });
    expect(standardRunRate({ ytd: 70, last4w: null, last13w: 10 })).toEqual({ rate: 70, basis: "ytd" });
    expect(standardRunRate({ ytd: -5, last4w: -1, last13w: -2 }).rate).toBe(0);
  });
});

describe("resolveCoverThresholds", () => {
  const rows: CoverTargetRow[] = [
    { scope: "PRINCIPAL", principalKey: "mars", brand: "", targetDays: 21, reorderDays: 10, overstockDays: null },
    { scope: "BRAND", principalKey: "mars", brand: "Galaxy", targetDays: 45, reorderDays: null, overstockDays: 90 },
  ];

  it("uses the defaults when nothing is set", () => {
    expect(resolveCoverThresholds(undefined, "mars")).toEqual({ targetDays: DEFAULT_TARGET_DAYS, reorderDays: DEFAULT_REORDER_DAYS, overstockDays: DEFAULT_OVERSTOCK_DAYS, source: "default" });
    expect(resolveCoverThresholds(rows, "bic").source).toBe("default");
  });

  it("uses the principal's values, falling back to the defaults for the ones it leaves blank", () => {
    expect(resolveCoverThresholds(rows, "mars")).toEqual({ targetDays: 21, reorderDays: 10, overstockDays: DEFAULT_OVERSTOCK_DAYS, source: "principal" });
  });

  it("lets a brand override its own values and inherit the rest from its principal", () => {
    expect(resolveCoverThresholds(rows, "mars", "Galaxy")).toEqual({ targetDays: 45, reorderDays: 10, overstockDays: 90, source: "brand" });
    expect(resolveCoverThresholds(rows, "mars", " galaxy ").targetDays).toBe(45); // spacing and case ignored
    expect(resolveCoverThresholds(rows, "mars", "Snickers").source).toBe("principal"); // a brand with no row of its own
  });

  it("treats a missing brand as Unspecified", () => {
    const withUnspecified: CoverTargetRow[] = [{ scope: "BRAND", principalKey: "mars", brand: "Unspecified", targetDays: 15, reorderDays: null, overstockDays: null }];
    expect(resolveCoverThresholds(withUnspecified, "mars", null).targetDays).toBe(15);
  });
});

describe("standard stock and the status tiers", () => {
  it("is the run rate over target days of cover", () => {
    expect(standardStockFor(700, 30)).toBeCloseTo(3000);
    expect(standardStockFor(-10, 30)).toBe(0);
  });

  it("compares stock held with the standard, null when there is no standard", () => {
    expect(stockVsStandardPct(1500, 3000)).toBe(50);
    expect(stockVsStandardPct(100, 0)).toBeNull();
  });

  it("applies a principal's own Running Out line", () => {
    expect(stockStatus(12, 500, 300)).toContain("Running Out"); // default 14
    expect(stockStatus(12, 500, 300, 10)).toContain("OK"); // this principal runs on 10
    expect(stockStatus(1, 500, 300, 10)).toContain("Out of Stock"); // the flat 2-day rule still applies
  });

  it("uses a SKU's own overstock line when it carries one", () => {
    expect(isOverstocked({ rrWeekValue: 10, daysCover: 70 })).toBe(true);
    expect(isOverstocked({ rrWeekValue: 10, daysCover: 70, overstockDays: 90 })).toBe(false);
  });
});

describe("roll-ups against the standard", () => {
  const item = (brand: string, openingValue: number, rrWeekValue: number, standardValue: number): StockItem =>
    ({ principal: "Mars-Nairobi", key: "mars", item: `${brand} ${openingValue}`, brand, openingVolume: 0, openingPcs: 1, openingValue, rrWeekValue, rrWeekVolume: 0, daysCover: 0, action: "🟢 OK", standardValue }) as StockItem;
  const dataset = {
    stockItems: [item("Galaxy", 1000, 700, 3000), item("Snickers", 200, 350, 1500)],
    stockCoverTargets: [
      { scope: "PRINCIPAL", principalKey: "mars", brand: "", targetDays: 30, reorderDays: 14, overstockDays: null },
      { scope: "BRAND", principalKey: "mars", brand: "Snickers", targetDays: 30, reorderDays: 5, overstockDays: null },
    ],
  } as unknown as Dataset;

  it("sums the standard per principal and brand and reports stock held as a percentage of it", () => {
    const [principal] = aggregateStockByPrincipal(dataset);
    expect(principal.standardValue).toBe(4500);
    expect(principal.vsStandardPct).toBe(26.7);
    const brands = aggregateStockByBrand(dataset, "mars");
    expect(brands.find((b) => b.brand === "Galaxy")?.vsStandardPct).toBe(33.3);
  });

  it("judges each brand against its own Running Out line", () => {
    const brands = aggregateStockByBrand(dataset, "mars");
    // Snickers: 200 of stock on 350 a week is 4 days of cover: Running Out on the default 14, but short of its own 5-day line too
    expect(brands.find((b) => b.brand === "Snickers")?.action).toContain("Running Out");
    expect(brands.find((b) => b.brand === "Snickers")?.targetDays).toBe(30);
  });
});

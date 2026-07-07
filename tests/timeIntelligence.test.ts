import { describe, it, expect } from "vitest";
import type { Dataset, MonthlySalesRow, MonthlyCoverageRow, MonthlyBrandCustomerRow } from "@/lib/types";
import {
  resolvePeriodMonths,
  getAvailableYears,
  getAvailableMonths,
  getDefaultPeriod,
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  summarizeCoverageForPeriod,
  summarizeCoverageByRep,
  summarizeBrandCustomerByCustomer,
  summarizeBrandCustomerByRep,
  summarizeBrandCustomerByPrincipal,
} from "@/lib/timeIntelligence";

function salesRow(overrides: Partial<MonthlySalesRow>): MonthlySalesRow {
  return {
    year: "2026",
    month: "January",
    monthIndex: 0,
    location: "Nairobi",
    principal: "EABL-Nyeri",
    principalKey: "eabl",
    revenue: 0,
    target: null,
    cogs: 0,
    grossProfit: 0,
    grossMarginPct: null,
    ...overrides,
  };
}

function coverageRow(overrides: Partial<MonthlyCoverageRow>): MonthlyCoverageRow {
  return {
    year: "2026",
    month: "January",
    monthIndex: 0,
    salesRole: "Primary Sales",
    employeeName: "Jane Doe",
    principal: "EABL-Nyeri",
    principalKey: "eabl",
    coverage: 0,
    productiveCalls: 0,
    productivityPct: 0,
    ...overrides,
  };
}

function brandCustomerRow(overrides: Partial<MonthlyBrandCustomerRow>): MonthlyBrandCustomerRow {
  return {
    year: "2026",
    month: "January",
    monthIndex: 0,
    principal: "EABL-Nyeri",
    principalKey: "eabl",
    salesEmployee: "Jane Doe",
    customerName: "Cash Customer",
    volume: 0,
    revenue: 0,
    grossProfit: 0,
    grossMarginPct: null,
    ...overrides,
  };
}

function buildDataset(overrides: Partial<Dataset>): Dataset {
  return {
    monthlySales: [],
    monthlyCoverage: [],
    monthlyBrandCustomer: [],
    weeklyProjection: [],
    stockTotal: {
      volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0,
      itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "",
    },
    stockItems: [],
    reportMeta: { title: "", sheet: "" },
    uploadedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePeriodMonths", () => {
  it("MTD/MONTH resolves to a single month", () => {
    expect(resolvePeriodMonths({ kind: "MTD", year: "2026", month: "June" })).toEqual([{ year: "2026", monthIndex: 5 }]);
  });

  it("YTD resolves January through the selected month, inclusive", () => {
    const months = resolvePeriodMonths({ kind: "YTD", year: "2026", month: "March" });
    expect(months).toEqual([
      { year: "2026", monthIndex: 0 },
      { year: "2026", monthIndex: 1 },
      { year: "2026", monthIndex: 2 },
    ]);
  });

  it("QTD resolves quarter-start through the selected month, not the full quarter", () => {
    const months = resolvePeriodMonths({ kind: "QTD", year: "2026", month: "May" }); // Q2 = Apr-Jun
    expect(months).toEqual([
      { year: "2026", monthIndex: 3 },
      { year: "2026", monthIndex: 4 },
    ]);
  });

  it("Q1-Q4 always resolve the full 3-month quarter regardless of the selected month", () => {
    expect(resolvePeriodMonths({ kind: "Q2", year: "2026" }).map((m) => m.monthIndex)).toEqual([3, 4, 5]);
    expect(resolvePeriodMonths({ kind: "Q4", year: "2026" }).map((m) => m.monthIndex)).toEqual([9, 10, 11]);
  });

  it("H1/H2 always resolve the full half-year", () => {
    expect(resolvePeriodMonths({ kind: "H1", year: "2026" }).map((m) => m.monthIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(resolvePeriodMonths({ kind: "H2", year: "2026" }).map((m) => m.monthIndex)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("returns an empty array when a required month is missing", () => {
    expect(resolvePeriodMonths({ kind: "MTD", year: "2026" })).toEqual([]);
  });
});

describe("dataset availability helpers", () => {
  const dataset = buildDataset({
    monthlySales: [
      salesRow({ year: "2025", month: "May", monthIndex: 4 }),
      salesRow({ year: "2026", month: "June", monthIndex: 5 }),
      salesRow({ year: "2026", month: "July", monthIndex: 6 }),
    ],
  });

  it("getAvailableYears returns sorted distinct years", () => {
    expect(getAvailableYears(dataset)).toEqual(["2025", "2026"]);
  });

  it("getAvailableMonths returns only months present for that year, in calendar order", () => {
    expect(getAvailableMonths(dataset, "2026")).toEqual(["June", "July"]);
  });

  it("getDefaultPeriod defaults to MTD of the latest year/month present", () => {
    expect(getDefaultPeriod(dataset)).toEqual({ kind: "MTD", year: "2026", month: "July" });
  });
});

describe("summarizeSalesForPeriod — the null-target invariant", () => {
  it("resolves target for a single month when that month has a non-null target", () => {
    const dataset = buildDataset({
      monthlySales: [
        salesRow({ year: "2026", month: "May", monthIndex: 4, revenue: 100000, target: 90000 }),
        salesRow({ year: "2026", month: "June", monthIndex: 5, revenue: 110000, target: 95000 }),
      ],
    });
    const summary = summarizeSalesForPeriod(dataset, { kind: "MONTH", year: "2026", month: "May" }, null);
    expect(summary.target).toBe(90000);
    expect(summary.revenue).toBe(100000);
  });

  it("returns target=null only when there is zero target data anywhere in the match — a single missing row doesn't poison the rest", () => {
    const dataset = buildDataset({
      monthlySales: [
        salesRow({ year: "2025", month: "May", monthIndex: 4, revenue: 50000, target: null }),
        salesRow({ year: "2026", month: "January", monthIndex: 0, revenue: 60000, target: 55000 }),
        // February has two principals; one lacks a target (e.g. not yet targeted) —
        // this must NOT null out the whole period, unlike the old stricter behavior.
        salesRow({ principal: "EABL-Nyeri", principalKey: "eabl", year: "2026", month: "February", monthIndex: 1, revenue: 65000, target: 58000 }),
        salesRow({ principal: "Upfield-Nairobi", principalKey: "upfield", year: "2026", month: "February", monthIndex: 1, revenue: 20000, target: null }),
      ],
    });
    const ytd = summarizeSalesForPeriod(dataset, { kind: "YTD", year: "2026", month: "February" }, null);
    expect(ytd.target).toBe(55000 + 58000); // Upfield's null row contributes 0, not a full null
    expect(ytd.revenue).toBe(60000 + 65000 + 20000); // revenue still includes the untargeted row

    // A 2025 month has zero target data at all -> genuinely null.
    const y2025 = summarizeSalesForPeriod(dataset, { kind: "MTD", year: "2025", month: "May" }, null);
    expect(y2025.target).toBeNull();
    expect(y2025.revenue).toBe(50000); // revenue is still reported even without a target
  });

  it("sums whatever target data exists even when a requested month has no rows at all", () => {
    const dataset = buildDataset({
      monthlySales: [salesRow({ year: "2026", month: "March", monthIndex: 2, revenue: 10000, target: 9000 })],
    });
    // YTD through March asks for Jan+Feb+Mar; Jan/Feb have no rows at all, but March
    // does — a partial sum from the months we have is more useful than "N/A".
    const summary = summarizeSalesForPeriod(dataset, { kind: "YTD", year: "2026", month: "March" }, null);
    expect(summary.target).toBe(9000);
    expect(summary.revenue).toBe(10000); // revenue only sums rows that actually exist
    expect(summary.monthsIncluded).toBe(1); // signals only 1 of 3 requested months had data
  });

  it("computes achievementPct and grossMarginPct only when their denominators are positive", () => {
    const dataset = buildDataset({
      monthlySales: [salesRow({ year: "2026", month: "June", monthIndex: 5, revenue: 100000, target: 80000, grossProfit: 15000 })],
    });
    const summary = summarizeSalesForPeriod(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    expect(summary.achievementPct).toBe(125);
    expect(summary.grossMarginPct).toBe(15);
  });

  it("filters by principalKey when provided", () => {
    const dataset = buildDataset({
      monthlySales: [
        salesRow({ principal: "EABL-Nyeri", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, revenue: 40000 }),
        salesRow({ principal: "Upfield-Nairobi", principalKey: "upfield", year: "2026", month: "June", monthIndex: 5, revenue: 60000 }),
      ],
    });
    const eabl = summarizeSalesForPeriod(dataset, { kind: "MTD", year: "2026", month: "June" }, "eabl");
    expect(eabl.revenue).toBe(40000);
    const all = summarizeSalesForPeriod(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    expect(all.revenue).toBe(100000);
  });
});

describe("summarizeSalesByPrincipal", () => {
  it("groups by normalized principalKey, rolling up multi-region rows onto one brand", () => {
    const dataset = buildDataset({
      monthlySales: [
        salesRow({ principal: "EABL-Nyeri", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, revenue: 40000 }),
        salesRow({ principal: "EABL-Nyahururu", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, revenue: 30000 }),
        salesRow({ principal: "Upfield-Nairobi", principalKey: "upfield", year: "2026", month: "June", monthIndex: 5, revenue: 60000 }),
      ],
    });
    const byPrincipal = summarizeSalesByPrincipal(dataset, { kind: "MTD", year: "2026", month: "June" });
    expect(byPrincipal.get("eabl")?.revenue).toBe(70000);
    expect(byPrincipal.get("upfield")?.revenue).toBe(60000);
    expect(byPrincipal.size).toBe(2);
  });
});

describe("coverage summaries", () => {
  const dataset = buildDataset({
    monthlyCoverage: [
      coverageRow({ employeeName: "Jane Doe", principal: "EABL-Nyeri", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, coverage: 100, productiveCalls: 80 }),
      coverageRow({ employeeName: "Jane Doe", principal: "Upfield-Nairobi", principalKey: "upfield", year: "2026", month: "June", monthIndex: 5, coverage: 50, productiveCalls: 45 }),
      coverageRow({ employeeName: "John Smith", principal: "EABL-Nyahururu", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, coverage: 60, productiveCalls: 50 }),
    ],
  });

  it("summarizeCoverageForPeriod sums across all reps for the period", () => {
    const summary = summarizeCoverageForPeriod(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    expect(summary.coverage).toBe(210);
    expect(summary.productiveCalls).toBe(175);
  });

  it("summarizeCoverageByRep aggregates a rep's coverage across principals", () => {
    const byRep = summarizeCoverageByRep(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    const jane = byRep.find((r) => r.employeeName === "Jane Doe")!;
    expect(jane.coverage).toBe(150); // 100 + 50, across two principals
    expect(jane.productiveCalls).toBe(125);
  });

  it("summarizeCoverageByRep filters by principalKey", () => {
    const byRep = summarizeCoverageByRep(dataset, { kind: "MTD", year: "2026", month: "June" }, "eabl");
    expect(byRep).toHaveLength(2); // Jane Doe (EABL-Nyeri) + John Smith (EABL-Nyahururu)
    expect(byRep.every((r) => r.coverage > 0)).toBe(true);
  });
});

describe("brand & customer summaries", () => {
  const dataset = buildDataset({
    monthlyBrandCustomer: [
      brandCustomerRow({ customerName: "Cash Customer", salesEmployee: "Jane Doe", principal: "EABL-Nyeri", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, revenue: 50000, grossProfit: 8000 }),
      brandCustomerRow({ customerName: "Cash Customer", salesEmployee: "Jane Doe", principal: "Upfield-Nairobi", principalKey: "upfield", year: "2026", month: "June", monthIndex: 5, revenue: 20000, grossProfit: 2000 }),
      brandCustomerRow({ customerName: "Golden Marketing", salesEmployee: "John Smith", principal: "EABL-Nyahururu", principalKey: "eabl", year: "2026", month: "June", monthIndex: 5, revenue: 30000, grossProfit: 4500 }),
    ],
  });

  it("summarizeBrandCustomerByCustomer aggregates across principals/reps for the same customer", () => {
    const byCustomer = summarizeBrandCustomerByCustomer(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    const cash = byCustomer.find((c) => c.customerName === "Cash Customer")!;
    expect(cash.revenue).toBe(70000);
    expect(cash.grossMarginPct).toBe(round1((10000 / 70000) * 100));
  });

  it("summarizeBrandCustomerByRep aggregates a rep's revenue across principals/customers", () => {
    const byRep = summarizeBrandCustomerByRep(dataset, { kind: "MTD", year: "2026", month: "June" }, null);
    const jane = byRep.find((r) => r.salesEmployee === "Jane Doe")!;
    expect(jane.revenue).toBe(70000);
  });

  it("summarizeBrandCustomerByPrincipal rolls up multi-region principals onto one brand key", () => {
    const byPrincipal = summarizeBrandCustomerByPrincipal(dataset, { kind: "MTD", year: "2026", month: "June" });
    const eabl = byPrincipal.find((p) => p.principalKey === "eabl")!;
    expect(eabl.revenue).toBe(50000 + 30000);
  });
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

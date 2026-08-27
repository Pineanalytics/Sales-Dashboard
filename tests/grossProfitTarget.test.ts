import { describe, expect, it } from "vitest";
import { grossProfitTargetForPeriod, grossProfitTargetPerformance, grossProfitTargetRate } from "../lib/grossProfitTarget";
import type { Dataset, MonthlySalesRow } from "../lib/types";

function salesRow(principal: string, target: number | null): MonthlySalesRow {
  return {
    year: "2026",
    month: "August",
    monthIndex: 7,
    location: "Nairobi",
    principal,
    principalKey: principal.toLowerCase(),
    revenue: 0,
    target,
    cogs: 0,
    grossProfit: 0,
    grossMarginPct: null,
  };
}

function dataset(monthlySales: MonthlySalesRow[]): Dataset {
  return {
    monthlySales,
    monthlyCoverage: [],
    monthlyCoverageTargets: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    stockTotal: { volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0, itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "" },
    stockItems: [],
    reportMeta: { title: "Test", sheet: "Test" },
    uploadedAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("grossProfitTargetRate", () => {
  it("uses 15% for Mars, 20% for the BDM portfolio, and 10% otherwise", () => {
    expect(grossProfitTargetRate("Mars-Nairobi")).toBe(0.15);
    expect(grossProfitTargetRate("EFL-Nairobi")).toBe(0.2);
    expect(grossProfitTargetRate("Energia-Nairobi")).toBe(0.2);
    expect(grossProfitTargetRate("EABL-Nyeri")).toBe(0.1);
  });
});

describe("grossProfitTargetForPeriod", () => {
  it("weights each principal before summing the all-principal GP target", () => {
    const result = grossProfitTargetForPeriod(
      dataset([salesRow("EABL-Nyeri", 100), salesRow("Mars-Nairobi", 100), salesRow("EFL-Nairobi", 100)]),
      { kind: "MONTH", year: "2026", month: "August" },
      null
    );
    expect(result).toBe(45);
  });

  it("honours a selected principal and returns null when no revenue target exists", () => {
    const rows = dataset([salesRow("Mars-Nairobi", 200), salesRow("EABL-Nyeri", 100)]);
    expect(grossProfitTargetForPeriod(rows, { kind: "MONTH", year: "2026", month: "August" }, "Mars-Nairobi")).toBe(30);
    expect(grossProfitTargetForPeriod(dataset([salesRow("Mars-Nairobi", null)]), { kind: "MONTH", year: "2026", month: "August" }, null)).toBeNull();
  });
});

describe("grossProfitTargetPerformance", () => {
  it("returns GP attainment and the signed value variance", () => {
    expect(grossProfitTargetPerformance(12, 10)).toEqual({ attainmentPct: 120, variance: 2 });
    expect(grossProfitTargetPerformance(8, 10)).toEqual({ attainmentPct: 80, variance: -2 });
  });

  it("keeps attainment unavailable when no usable GP target exists", () => {
    expect(grossProfitTargetPerformance(8, null)).toEqual({ attainmentPct: null, variance: null });
    expect(grossProfitTargetPerformance(8, 0)).toEqual({ attainmentPct: null, variance: 8 });
  });
});

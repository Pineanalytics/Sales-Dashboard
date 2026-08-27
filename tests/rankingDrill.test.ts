import { describe, expect, it } from "vitest";
import { summarizeRankingDrill } from "../lib/rankingDrill";
import type { MonthlyBrandCustomerRow } from "../lib/types";

function row(overrides: Partial<MonthlyBrandCustomerRow>): MonthlyBrandCustomerRow {
  return {
    date: "2026-08-01", year: "2026", month: "August", monthIndex: 7,
    principal: "Mars-Nairobi", principalKey: "mars", brand: "Brand A",
    salesEmployee: "Rep A", customerName: "Customer A", cases: 10,
    revenue: 100, grossProfit: 15, grossMarginPct: 15, ...overrides,
  };
}

describe("summarizeRankingDrill", () => {
  it("keeps portfolio totals and contribution dimensions at their own grain", () => {
    const result = summarizeRankingDrill([
      row({}),
      row({ principal: "EABL-Nyeri", principalKey: "eabl", brand: "Brand B", salesEmployee: "Rep B", customerName: "Customer B", revenue: 50, grossProfit: 5, cases: 4 }),
      row({ principal: "EABL-Nyeri", principalKey: "eabl", brand: "Brand B", salesEmployee: "Rep A", customerName: "Customer A", revenue: 25, grossProfit: 5, cases: 2 }),
    ]);

    expect(result.totals).toMatchObject({ revenue: 175, grossProfit: 25, cases: 16, customerCount: 2, repCount: 2, brandCount: 2 });
    expect(result.customers[0]).toMatchObject({ name: "Customer A", revenue: 125, grossProfit: 20 });
    expect(result.principals).toHaveLength(2);
    expect(result.totals.topFiveCustomerSharePct).toBe(100);
  });
});

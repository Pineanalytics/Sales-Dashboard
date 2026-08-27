import { describe, expect, it } from "vitest";
import { summarizeCustomerPortfolio } from "../lib/customerPortfolio";
import type { MonthlyBrandCustomerRow } from "../lib/types";

function row(customerName: string, revenue: number, overrides: Partial<MonthlyBrandCustomerRow> = {}): MonthlyBrandCustomerRow {
  return { date: "2026-08-01", year: "2026", month: "August", monthIndex: 7, principal: "Mars-Nairobi", principalKey: "mars", brand: "Brand A", salesEmployee: "Rep A", customerName, cases: 1, revenue, grossProfit: revenue * .1, grossMarginPct: 10, ...overrides };
}

describe("summarizeCustomerPortfolio", () => {
  it("ranks, tiers and compares customers without mixing comparison revenue into selected totals", () => {
    const result = summarizeCustomerPortfolio({
      currentRows: [row("Alpha", 80), row("Beta", 15), row("Gamma", 5), row("Credit", -2)],
      latestMonthRows: [row("Alpha", 20), row("Beta", 5)],
      previousMonthRows: [row("Alpha", 10), row("Gamma", 4)],
      priorYearRows: [row("Alpha", 40), row("Beta", 10)],
    });
    expect(result.totals.revenue).toBe(98);
    expect(result.customers.map((customer) => customer.tier)).toEqual(["Strategic", "Growth", "Long Tail", "Adjustment"]);
    expect(result.customers[0]).toMatchObject({ customerName: "Alpha", momGrowthPct: 100, yoyGrowthPct: 100 });
    expect(result.totals).toMatchObject({ retainedCustomers: 1, newCustomers: 1, lapsedCustomers: 1 });
  });

  it("normalizes customer case and whitespace but preserves punctuation distinctions", () => {
    const result = summarizeCustomerPortfolio({ currentRows: [row("Acme Shop", 10), row("  ACME   SHOP ", 5), row("Acme-Shop", 7)], latestMonthRows: [], previousMonthRows: [], priorYearRows: [] });
    expect(result.totals.customerCount).toBe(2);
    expect(result.customers[0].revenue).toBe(15);
  });
});

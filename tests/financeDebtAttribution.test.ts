import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  receivablesSyncRun: { findFirst: vi.fn() },
  customerCreditProfile: { findMany: vi.fn() },
  receivableOpenItem: { groupBy: vi.fn() },
  brandCustomerActual: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { getDebtByPrincipal, trailing12MonthWindow } from "../lib/financeDebtAttribution";

describe("trailing12MonthWindow", () => {
  it("spans two calendar years when the window crosses a year end", () => {
    const window = trailing12MonthWindow(new Date(Date.UTC(2026, 9, 6))); // Oct 2026
    expect(window).toEqual([
      { year: "2026", monthIndexes: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] },
      { year: "2025", monthIndexes: [11, 10] },
    ]);
    expect(window.reduce((sum, w) => sum + w.monthIndexes.length, 0)).toBe(12);
  });

  it("is a single year when it ends in December", () => {
    expect(trailing12MonthWindow(new Date(Date.UTC(2026, 11, 1)))).toEqual([{ year: "2026", monthIndexes: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0] }]);
  });
});

describe("getDebtByPrincipal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.receivablesSyncRun.findFirst.mockResolvedValue({ id: "run" });
    db.customerCreditProfile.findMany.mockResolvedValue([
      { customerCode: "C1", customerName: "Alpha Wines Ltd" },
      { customerCode: "C2", customerName: "Beta Stores" },
      { customerCode: "C3", customerName: "Settled Customer" },
      { customerCode: "C4", customerName: "Dust Customer" },
    ]);
    db.receivableOpenItem.groupBy.mockResolvedValue([
      { customerCode: "C1", _sum: { openBalance: 1000 } },
      { customerCode: "C2", _sum: { openBalance: 500 } },
      { customerCode: "C3", _sum: { openBalance: 0 } },
      { customerCode: "C4", _sum: { openBalance: 1e-12 } },
    ]);
    db.brandCustomerActual.groupBy.mockResolvedValue([
      { customerName: "Alpha Wines Ltd", principal: "Mars-Nairobi", _sum: { revenue: 300 } },
      { customerName: "Alpha Wines Ltd", principal: "EABL-Nyeri", _sum: { revenue: 100 } },
      { customerName: "Alpha Wines Ltd", principal: "EABL-Nyahururu", _sum: { revenue: 100 } },
    ]);
  });

  it("splits a customer's balance across the principals it bought from, and reports the rest as unattributed", async () => {
    const debt = await getDebtByPrincipal();
    expect(debt.totalDebt).toBeCloseTo(1500, 6);
    expect(debt.unattributedDebt).toBe(500);
    const byName = Object.fromEntries(debt.byPrincipal.map((row) => [row.principal, row.debt]));
    expect(byName.Mars).toBeCloseTo(600, 6); // 300 of 500 revenue
    expect(byName.EABL).toBeCloseTo(400, 6); // two EABL locations merge into one brand
    expect(byName.Unattributed).toBe(500);
  });

  it("leaves out customers whose balance is zero or floating-point dust", async () => {
    const debt = await getDebtByPrincipal();
    expect(debt.customers.map((customer) => customer.customerCode)).toEqual(["C1", "C2"]);
  });

  it("returns the same totals without the per-customer list when asked", async () => {
    const full = await getDebtByPrincipal();
    const light = await getDebtByPrincipal({ includeCustomers: false });
    expect(light.customers).toEqual([]);
    expect(light.totalDebt).toBe(full.totalDebt);
    expect(light.byPrincipal).toEqual(full.byPrincipal);
  });

  it("asks the database for the trailing 12 months only, summed per customer and principal", async () => {
    await getDebtByPrincipal();
    const call = db.brandCustomerActual.groupBy.mock.calls[0][0];
    expect(call.by).toEqual(["customerName", "principal"]);
    expect(call._sum).toEqual({ revenue: true });
    expect(call.where.OR.reduce((n: number, w: { monthIndex: { in: number[] } }) => n + w.monthIndex.in.length, 0)).toBe(12);
  });

  it("is empty before the first receivables sync", async () => {
    db.receivablesSyncRun.findFirst.mockResolvedValue(null);
    const debt = await getDebtByPrincipal();
    expect(debt).toMatchObject({ totalDebt: 0, byPrincipal: [], customers: [] });
    expect(db.brandCustomerActual.groupBy).not.toHaveBeenCalled();
  });
});

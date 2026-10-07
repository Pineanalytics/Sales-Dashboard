import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  payableOpenItem: { groupBy: vi.fn() },
  payablesSyncRun: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { getPayablesByPrincipal, getPayablesDashboard, getPayablesFinanceData } from "../lib/payables";

describe("payables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payableOpenItem.groupBy.mockResolvedValue([
      { vendorCode: "S-0006", vendorName: "Suntory Beverage", _sum: { openBalance: 700 } },
      { vendorCode: "S-0135", vendorName: "Bidco Africa", _sum: { openBalance: 300 } }, // mapped to Suntory as well
      { vendorCode: "S-0124", vendorName: "Mars Wrigley", _sum: { openBalance: 900 } },
      { vendorCode: "X-9999", vendorName: "Some Other Vendor", _sum: { openBalance: 50 } },
      { vendorCode: "X-9999", vendorName: "Some Other Vendor (renamed)", _sum: { openBalance: 25 } }, // same code under a second name
    ]);
    db.payablesSyncRun.findFirst.mockResolvedValue({ sourceDate: new Date("2026-10-06T00:00:00Z"), vendorCount: 4, openItemCount: 12, ledgerBalance: 1975 });
  });

  it("rolls vendors up to their mapped principals; unmapped vendors are left out of the split", async () => {
    const rows = await getPayablesByPrincipal();
    expect(Object.fromEntries(rows.map((r) => [r.principalKey, r.outstanding]))).toEqual({ suntory: 1000, mars: 900 });
  });

  it("lists the largest vendors, merging a vendor code that appears under two names", async () => {
    const dashboard = await getPayablesDashboard();
    expect(dashboard?.ledgerBalance).toBe(1975);
    expect(dashboard?.largestVendors.map((v) => [v.vendorCode, v.outstanding])).toEqual([
      ["S-0124", 900],
      ["S-0006", 700],
      ["S-0135", 300],
      ["X-9999", 75],
    ]);
  });

  it("gives the totals and the principal split from one read of the open items", async () => {
    const data = await getPayablesFinanceData();
    expect(db.payableOpenItem.groupBy).toHaveBeenCalledTimes(1);
    expect(data.dashboard?.vendorCount).toBe(4);
    expect(data.byPrincipal.length).toBe(2);
  });

  it("has no dashboard before the first payables sync", async () => {
    db.payablesSyncRun.findFirst.mockResolvedValue(null);
    expect((await getPayablesFinanceData()).dashboard).toBeNull();
  });
});

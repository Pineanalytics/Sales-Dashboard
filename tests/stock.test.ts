import { describe, expect, it } from "vitest";
import { aggregateStockByBrand, aggregateStockByPrincipal, classifyDormantPrincipals, sumStockRollups } from "@/lib/stock";
import type { Dataset, MonthlySalesRow, StockItem } from "@/lib/types";

function salesRow(overrides: Partial<MonthlySalesRow>): MonthlySalesRow {
  return {
    year: "2026", month: "July", monthIndex: 6, location: "Nairobi",
    principal: "Mars-Nairobi", principalKey: "mars", revenue: 0, target: null,
    cogs: 0, grossProfit: 0, grossMarginPct: null,
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

describe("classifyDormantPrincipals", () => {
  it("marks a principal dormant when it has zero revenue across the latest three periods present", () => {
    const ds = dataset({
      monthlySales: [
        salesRow({ year: "2026", month: "May", monthIndex: 4, principal: "Durex-Nairobi", principalKey: "durex", revenue: 0 }),
        salesRow({ year: "2026", month: "June", monthIndex: 5, principal: "Durex-Nairobi", principalKey: "durex", revenue: 0 }),
        salesRow({ year: "2026", month: "July", monthIndex: 6, principal: "Durex-Nairobi", principalKey: "durex", revenue: 0 }),
        salesRow({ year: "2026", month: "July", monthIndex: 6, principal: "Mars-Nairobi", principalKey: "mars", revenue: 5000 }),
      ],
    });
    const result = classifyDormantPrincipals(ds, ["durex", "mars"]);
    expect(result.dormantKeys.has("durex")).toBe(true);
    expect(result.activeKeys.has("mars")).toBe(true);
  });

  it("only looks at the three most recent periods present, not the whole history", () => {
    const ds = dataset({
      monthlySales: [
        // Revenue exists, but only in a much older period than the latest three.
        salesRow({ year: "2025", month: "January", monthIndex: 0, principal: "Signify-Nairobi", principalKey: "signify", revenue: 9000 }),
        salesRow({ year: "2026", month: "May", monthIndex: 4, principal: "Signify-Nairobi", principalKey: "signify", revenue: 0 }),
        salesRow({ year: "2026", month: "June", monthIndex: 5, principal: "Signify-Nairobi", principalKey: "signify", revenue: 0 }),
        salesRow({ year: "2026", month: "July", monthIndex: 6, principal: "Signify-Nairobi", principalKey: "signify", revenue: 0 }),
      ],
    });
    const result = classifyDormantPrincipals(ds, ["signify"]);
    expect(result.dormantKeys.has("signify")).toBe(true);
  });

  it("exempts emerging principals regardless of recent revenue", () => {
    const ds = dataset({
      monthlySales: [salesRow({ year: "2026", month: "July", monthIndex: 6, principal: "Energia-Nairobi", principalKey: "energia", revenue: 0 })],
    });
    const result = classifyDormantPrincipals(ds, ["energia"]);
    expect(result.activeKeys.has("energia")).toBe(true);
    expect(result.dormantKeys.has("energia")).toBe(false);
  });

  it("treats a principal with any positive revenue in the window as active", () => {
    const ds = dataset({
      monthlySales: [
        salesRow({ year: "2026", month: "May", monthIndex: 4, principal: "Bic-Nairobi", principalKey: "bic", revenue: 0 }),
        salesRow({ year: "2026", month: "July", monthIndex: 6, principal: "Bic-Nairobi", principalKey: "bic", revenue: 1 }),
      ],
    });
    const result = classifyDormantPrincipals(ds, ["bic"]);
    expect(result.activeKeys.has("bic")).toBe(true);
  });
});

describe("aggregateStockByBrand", () => {
  it("groups by (principal, brand) so same-named brands under different principals never merge", () => {
    const ds = dataset({
      stockItems: [
        stockItem({ principal: "Unilever-Nairobi", key: "unilever", item: "Omo 1kg", brand: "Omo", openingValue: 100 }),
        stockItem({ principal: "Unilever-Nairobi", key: "unilever", item: "Omo 2kg", brand: "Omo", openingValue: 50 }),
        stockItem({ principal: "Mars-Nairobi", key: "mars", item: "Omo-branded snack", brand: "Omo", openingValue: 30 }),
      ],
    });
    const rollups = aggregateStockByBrand(ds);
    const unileverOmo = rollups.find((r) => r.principalKey === "unilever" && r.brand === "Omo");
    const marsOmo = rollups.find((r) => r.principalKey === "mars" && r.brand === "Omo");
    expect(unileverOmo?.value).toBe(150);
    expect(unileverOmo?.itemCount).toBe(2);
    expect(marsOmo?.value).toBe(30);
  });

  it("buckets a missing brand under Unspecified instead of dropping the item", () => {
    const ds = dataset({ stockItems: [stockItem({ brand: null, openingValue: 10 })] });
    const rollups = aggregateStockByBrand(ds);
    expect(rollups).toEqual([expect.objectContaining({ brand: "Unspecified", value: 10 })]);
  });

  it("scopes to one principal when given a key", () => {
    const ds = dataset({
      stockItems: [
        stockItem({ principal: "Unilever-Nairobi", key: "unilever", brand: "Omo" }),
        stockItem({ principal: "Mars-Nairobi", key: "mars", brand: "Snickers" }),
      ],
    });
    const rollups = aggregateStockByBrand(ds, "mars");
    expect(rollups).toEqual([expect.objectContaining({ principalKey: "mars", brand: "Snickers" })]);
  });

  it("shows a genuinely out-of-stock item even though it's a small share of the brand's pooled value and run rate", () => {
    // Pooled: 100,000 of stock on 15,000/week run rate is ~47 days of cover - "OK" against the 14-day default.
    // That blended number hides that one of the two items is completely out of stock.
    const ds = dataset({
      stockItems: [
        stockItem({ principal: "Mars-Nairobi", key: "mars", brand: "Galaxy", item: "Galaxy 1kg", openingValue: 100_000, rrWeekValue: 10_000, action: "🟢 OK" }),
        stockItem({ principal: "Mars-Nairobi", key: "mars", brand: "Galaxy", item: "Galaxy 2kg", openingValue: 0, rrWeekValue: 5_000, action: "🔴 Out of Stock - To Order" }),
      ],
    });
    const [brand] = aggregateStockByBrand(ds);
    expect(brand.action).toContain("Out of Stock");
    expect(brand.outOfStockCount).toBe(1);
  });
});

describe("aggregateStockByPrincipal and sumStockRollups", () => {
  // Same shape as the brand case above: pooled value/run-rate alone would read as a healthy "OK" principal.
  const items = [
    stockItem({ principal: "Mars-Nairobi", key: "mars", item: "Galaxy 1kg", openingValue: 100_000, rrWeekValue: 10_000, action: "🟢 OK" }),
    stockItem({ principal: "Mars-Nairobi", key: "mars", item: "Galaxy 2kg", openingValue: 0, rrWeekValue: 5_000, action: "🔴 Out of Stock - To Order" }),
  ];

  it("shows the principal's worst-off actively-sold item, not a re-blended pooled average", () => {
    const [principal] = aggregateStockByPrincipal(dataset({ stockItems: items }));
    expect(principal.action).toContain("Out of Stock");
  });

  it("carries the same worst-status rule into the grand total", () => {
    const rollups = aggregateStockByPrincipal(dataset({ stockItems: items }));
    expect(sumStockRollups(rollups).action).toContain("Out of Stock");
  });

  it("only reaches Out of Stock through a real stockout, not just low pooled cover", () => {
    // Both items individually Running Out (not Out of Stock): the principal must say Running Out, not escalate.
    const runningOutItems = [
      stockItem({ principal: "Mars-Nairobi", key: "mars", item: "A", openingValue: 1000, rrWeekValue: 700, action: "🟡 Running Out" }),
      stockItem({ principal: "Mars-Nairobi", key: "mars", item: "B", openingValue: 200, rrWeekValue: 350, action: "🟡 Running Out" }),
    ];
    const [principal] = aggregateStockByPrincipal(dataset({ stockItems: runningOutItems }));
    expect(principal.action).toContain("Running Out");
    expect(principal.action).not.toContain("Out of Stock");
  });
});

import { describe, it, expect } from "vitest";
import { parseWorkbook, weightedCoverDays, stockStatus, WorkbookParseError } from "@/lib/parseWorkbook";
import { normalizePrincipalKey } from "@/lib/normalize";
import { buildFixtureWorkbook, monthlySalesRows, brandCustomerRowsNoOptionalCols } from "./fixtures/buildWorkbook";

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

describe("parseWorkbook — monthly sales vs target", () => {
  const dataset = parseWorkbook(buildFixtureWorkbook(), "2026-06-30T00:00:00.000Z");

  it("extracts the report title from the rows above the header", () => {
    expect(dataset.reportMeta.title).toBe("MONTHLY SALES VS TARGET");
  });

  it("excludes 'Total'/'Grand Total' rows and keeps only real principal rows", () => {
    expect(dataset.monthlySales).toHaveLength(6);
    expect(dataset.monthlySales.some((r) => r.principal.toLowerCase().includes("total"))).toBe(false);
  });

  it("treats a blank Monthly Target as null, never coerced to 0 — the key 2025-vs-2026 invariant", () => {
    const may2025 = dataset.monthlySales.find((r) => r.year === "2025" && r.principal === "EABL-Nyeri")!;
    expect(may2025.target).toBeNull();
    const june2026 = dataset.monthlySales.find((r) => r.year === "2026" && r.principal === "EABL-Nyeri")!;
    expect(june2026.target).toBe(120000);
  });

  it("converts Gross Margin % fractions to 1dp percentages", () => {
    const june2026 = dataset.monthlySales.find((r) => r.year === "2026" && r.principal === "EABL-Nyeri")!;
    expect(june2026.grossMarginPct).toBe(13.6);
  });

  it("keys multi-region principal rows to the same normalized brand key", () => {
    const nyeri = dataset.monthlySales.find((r) => r.principal === "EABL-Nyeri")!;
    const nyahururu = dataset.monthlySales.find((r) => r.principal === "EABL-Nyahururu")!;
    expect(nyeri.principalKey).toBe("eabl");
    expect(nyahururu.principalKey).toBe("eabl");
  });

  it("computes monthIndex from the month name", () => {
    const june = dataset.monthlySales.find((r) => r.month === "June")!;
    expect(june.monthIndex).toBe(5);
    const may = dataset.monthlySales.find((r) => r.month === "May")!;
    expect(may.monthIndex).toBe(4);
  });
});

describe("parseWorkbook — monthly coverage (rep-level)", () => {
  const dataset = parseWorkbook(buildFixtureWorkbook());

  it("backfills the missing Year column from monthlySales' max year", () => {
    expect(dataset.monthlyCoverage.every((r) => r.year === "2026")).toBe(true);
  });

  it("skips rows with Employee Name 'Total'", () => {
    expect(dataset.monthlyCoverage).toHaveLength(6);
    expect(dataset.monthlyCoverage.some((r) => r.employeeName.toLowerCase().includes("total"))).toBe(false);
  });

  it("keeps rep-level detail: multiple reps per principal, multiple months per rep", () => {
    const janeRows = dataset.monthlyCoverage.filter((r) => r.employeeName === "Jane Doe");
    expect(janeRows).toHaveLength(4); // Jane covers EABL-Nyeri + Upfield-Nairobi, in both May and June
    const june = janeRows.filter((r) => r.month === "June");
    expect(june).toHaveLength(2);
  });

  it("converts Productivity % fractions to 1dp percentages", () => {
    const row = dataset.monthlyCoverage.find((r) => r.employeeName === "Jane Doe" && r.month === "May" && r.principal === "EABL-Nyeri")!;
    expect(row.productivityPct).toBe(83.3);
  });
});

describe("parseWorkbook — monthly brand & customer", () => {
  it("collapses transaction-line rows to one row per Year+Month+Principal+Rep+Customer, summing Volume/Revenue/GP", () => {
    const dataset = parseWorkbook(buildFixtureWorkbook());
    // 4 raw rows in the fixture collapse to 3: the two EABL-Nyeri/Jane Doe/Cash
    // Customer lines (different Item Name) merge into one.
    expect(dataset.monthlyBrandCustomer).toHaveLength(3);
    const row = dataset.monthlyBrandCustomer.find((r) => r.customerName === "Cash Customer" && r.principal === "EABL-Nyeri")!;
    expect(row.volume).toBe(100);
    expect(row.revenue).toBe(50000);
    expect(row.grossProfit).toBe(8000);
    // Derived from the summed totals (8000/50000*100), never from the per-line GP Margin % column.
    expect(row.grossMarginPct).toBe(16);
    expect(row.principalKey).toBe("eabl");
  });

  it("does not require an Item Name or GP Margin % column — derives margin from revenue/GP when absent", () => {
    const buffer = buildFixtureWorkbook({
      sheetOverrides: { "Brand&Customer Listing": brandCustomerRowsNoOptionalCols },
    });
    const dataset = parseWorkbook(buffer);
    expect(dataset.monthlyBrandCustomer).toHaveLength(1);
    const row = dataset.monthlyBrandCustomer[0];
    expect(row.grossMarginPct).toBe(16); // derived: 8000/50000*100
  });
});

describe("parseWorkbook — stock and weekly (unchanged sheets)", () => {
  const dataset = parseWorkbook(buildFixtureWorkbook());

  it("recomputes aggregate stock days/status rather than trusting per-row values", () => {
    const upfieldItems = dataset.stockItems.filter((i) => i.principal === "Upfield-Nairobi");
    expect(upfieldItems).toHaveLength(1);
    expect(upfieldItems[0].openingValue).toBe(0);
    expect(upfieldItems[0].action).toContain("Out of Stock");

    const eablItems = dataset.stockItems.filter((i) => i.key === "eabl");
    expect(eablItems).toHaveLength(3); // 2 EABL-Nyeri items + 1 EABL-Nyahururu item, same normalized key
  });

  it("flags items with stock but no recent run-rate as No Sales Data, not OK", () => {
    const weetabixItems = dataset.stockItems.filter((i) => i.principal === "Weetabix-Meru");
    expect(weetabixItems).toHaveLength(1);
    expect(weetabixItems[0].openingValue).toBe(900);
    expect(weetabixItems[0].action).toContain("No Sales Data");
    expect(dataset.stockTotal.noDataCount).toBeGreaterThanOrEqual(1);
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
    // The parser locates the header by content ("Year" in column A), not a fixed index.
    const withBlankRow = buildFixtureWorkbook({
      sheetOverrides: { "All Month Sales Vs Target": [[""], ...monthlySalesRows] },
    });
    const dataset = parseWorkbook(withBlankRow);
    expect(dataset.reportMeta.title).toBe("MONTHLY SALES VS TARGET");
    expect(dataset.monthlySales.find((r) => r.principal === "EABL-Nyeri" && r.year === "2025")?.revenue).toBe(100000);
  });
});

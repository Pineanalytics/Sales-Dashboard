import { describe, expect, it } from "vitest";
import { buildBrandExtract, buildCustomerExtract, combineExtracts, trimLargeExtract, type ExtractScope } from "../lib/brandCustomerExtract";
import { REPORT_DEFINITIONS } from "../lib/reports/definitions";
import type { MonthlyBrandCustomerRow } from "../lib/types";

const scope: ExtractScope = { principalLabel: "Mars", periodLabel: "Q3 2026", generatedAt: new Date("2026-10-02T08:00:00Z") };
const row = (over: Partial<MonthlyBrandCustomerRow>): MonthlyBrandCustomerRow =>
  ({ year: "2026", monthIndex: 6, principal: "Mars-Nairobi", brand: "Snickers", salesEmployee: "Jane", customerName: "Gitero Shop", cases: 5, revenue: 50_000, grossProfit: 5_000, ...over }) as MonthlyBrandCustomerRow;
const rows = [row({}), row({ monthIndex: 7, customerName: "Abdi Wholesalers", brand: "Twix", revenue: 80_000 })];

describe("the combined Customers & Brands extract", () => {
  const customers = buildCustomerExtract({ currentRows: rows, priorYearRows: [] }, scope);
  const brands = buildBrandExtract({ currentRows: rows, priorYearRows: [] }, scope);
  const combined = combineExtracts(customers, brands);

  it("keeps the customer sheets first and adds the brand roll-ups after them, with one Summary", () => {
    const names = combined.sheets.map((s) => s.name);
    expect(names[0]).toBe("Summary");
    expect(names.filter((n) => n === "Summary")).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(["Customer Ranking", "Customer by Month", "Brand Performance", "Brand by Month", "Brand by Rep", "Raw Data", "Brand Raw Data"]));
    expect(names.indexOf("Customer Ranking")).toBeLessThan(names.indexOf("Brand Performance"));
  });

  it("names the brand raw rows apart from the customer raw rows and counts both", () => {
    const customerRaw = combined.sheets.find((s) => s.name === "Raw Data")!;
    const brandRaw = combined.sheets.find((s) => s.name === "Brand Raw Data")!;
    expect(customerRaw.columns).toContain("Customer");
    expect(brandRaw.columns).toContain("SAP Account");
    expect(combined.rawRowCount).toBe(customers.rawRowCount + brands.rawRowCount);
  });

  it("drops the brand raw rows with the other row-level sheets when the selection is too large", () => {
    const trimmed = trimLargeExtract(combined, 1);
    const names = trimmed.sheets.map((s) => s.name);
    expect(names).not.toContain("Brand Raw Data");
    expect(names).not.toContain("Raw Data");
    expect(names).toContain("Brand Performance");
  });
});

describe("the Reports page's Customers & Brands report", () => {
  const def = REPORT_DEFINITIONS.find((d) => d.key === "customers")!;

  it("points Excel at the full extract for the chosen period and principal", () => {
    const url = def.fullExcelUrl!({ dataset: null, period: { kind: "Q3", year: "2026" }, principalKey: "mars", repFilter: null, periodLabel: "Q3 2026" });
    const params = new URL(url, "https://x.test").searchParams;
    expect(url.startsWith("/api/reports/brand-customer-extract?")).toBe(true);
    expect(params.get("kind")).toBe("all");
    expect(params.getAll("principal")).toEqual(["mars"]);
    expect(params.get("principalLabel")).toBe("mars");
    expect(params.getAll("period")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("asks for every principal when none is chosen", () => {
    const url = def.fullExcelUrl!({ dataset: null, period: { kind: "MONTH", year: "2026", month: "Sep" }, principalKey: null, repFilter: null, periodLabel: "Sep 2026" });
    const params = new URL(url, "https://x.test").searchParams;
    expect(params.getAll("principal")).toEqual([]);
    expect(params.get("principalLabel")).toBe("All principals");
  });
});

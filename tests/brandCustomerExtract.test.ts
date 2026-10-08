import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { buildBrandExtract, buildCustomerExtract, trimLargeExtract, type ExtractSheet } from "../lib/brandCustomerExtract";
import { extractToXlsxBuffer } from "../lib/extractWorkbook";
import { summarizeCustomerPortfolio } from "../lib/customerPortfolio";
import { REPORT_DEFINITIONS } from "../lib/reports/definitions";
import type { MonthlyBrandCustomerRow } from "../lib/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function row(over: Partial<MonthlyBrandCustomerRow> & { monthIndex?: number; year?: string }): MonthlyBrandCustomerRow {
  const year = over.year ?? "2026";
  const monthIndex = over.monthIndex ?? 8;
  return {
    date: `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`,
    year,
    month: MONTHS[monthIndex],
    monthIndex,
    principal: "Mars-Nairobi",
    principalKey: "mars",
    brand: "Galaxy 40g",
    salesEmployee: "Amina",
    customerName: "Naivas Westlands",
    cases: 10,
    revenue: 1000,
    grossProfit: 150,
    grossMarginPct: 15,
    ...over,
  };
}

const scope = { principalLabel: "Mars-Nairobi", periodLabel: "YTD October 2026", generatedAt: new Date("2026-10-08T06:00:00Z") };

const current: MonthlyBrandCustomerRow[] = [
  row({ monthIndex: 8, brand: "Galaxy 40g", salesEmployee: "Amina", customerName: "Naivas Westlands", cases: 10, revenue: 1000, grossProfit: 150 }),
  row({ monthIndex: 8, brand: "Galaxy 40g", salesEmployee: "Brian", customerName: "Quickmart  Kilimani", cases: 5, revenue: 500, grossProfit: 60 }),
  row({ monthIndex: 9, brand: "Galaxy 40g", salesEmployee: "Amina", customerName: "NAIVAS WESTLANDS", cases: 20, revenue: 2000, grossProfit: 300 }),
  row({ monthIndex: 9, brand: "Bounty 57g", salesEmployee: "Amina", customerName: "Naivas Westlands", cases: 4, revenue: 400, grossProfit: -20 }),
  // two rows for the same month/principal/brand/rep/customer (as the current month's daily rows arrive) merge into one raw row
  row({ monthIndex: 9, brand: "Bounty 57g", salesEmployee: "Amina", customerName: "Naivas Westlands", cases: 1, revenue: 100, grossProfit: 10 }),
  row({ monthIndex: 9, principal: "Suntory-Nairobi", principalKey: "suntory", brand: "Pepsi 500ml", salesEmployee: "Cheng", customerName: "Quickmart Kilimani", cases: 8, revenue: 800, grossProfit: 80 }),
];
const priorYear: MonthlyBrandCustomerRow[] = [
  row({ year: "2025", monthIndex: 9, brand: "Galaxy 40g", salesEmployee: "Amina", customerName: "Naivas Westlands", revenue: 1000, grossProfit: 100, cases: 8 }),
];
const totalRevenue = 1000 + 500 + 2000 + 400 + 100 + 800;

const sheet = (sheets: ExtractSheet[], name: string) => sheets.find((s) => s.name === name)!;
const col = (s: ExtractSheet, header: string) => s.columns.indexOf(header);

describe("buildBrandExtract", () => {
  const extract = buildBrandExtract({ currentRows: current, priorYearRows: priorYear }, scope);

  it("has the summary, the three analysis sheets and the raw data", () => {
    expect(extract.sheets.map((s) => s.name)).toEqual(["Summary", "Brand Performance", "Brand by Month", "Brand by Rep", "Raw Data"]);
    const summary = sheet(extract.sheets, "Summary");
    const get = (label: string) => summary.rows.find((r) => r[0] === label)?.[1];
    expect(get("Principal")).toBe("Mars-Nairobi");
    expect(get("Period")).toBe("YTD October 2026");
    expect(get("Revenue (value)")).toBe(totalRevenue);
    expect(get("Months with sales")).toBe("September 2026, October 2026");
    expect(get("Sales reps who sold")).toBe(3);
  });

  it("lists each principal's products by revenue with volume, value, margin, contribution and reps", () => {
    const s = sheet(extract.sheets, "Brand Performance");
    // Mars (3,500) before Suntory (800); Galaxy before Bounty within Mars
    expect(s.rows.map((r) => `${r[col(s, "Principal")]}|${r[col(s, "Brand / Product")]}`)).toEqual(["Mars-Nairobi|Galaxy 40g", "Mars-Nairobi|Bounty 57g", "Suntory-Nairobi|Pepsi 500ml"]);
    const galaxy = s.rows[0];
    expect(galaxy[col(s, "Rank in Principal")]).toBe(1);
    expect(galaxy[col(s, "Cases (Volume)")]).toBe(35);
    expect(galaxy[col(s, "Revenue (Value)")]).toBe(3500);
    expect(galaxy[col(s, "Gross Profit")]).toBe(510);
    expect(galaxy[col(s, "Margin %")]).toBe(14.6);
    expect(galaxy[col(s, "Revenue per Case")]).toBe(100);
    expect(galaxy[col(s, "Contribution % of Principal")]).toBe(87.5); // 3500 of Mars' 4000
    expect(galaxy[col(s, "Contribution % of Total")]).toBe(r1(3500, totalRevenue));
    expect(galaxy[col(s, "Customers")]).toBe(2);
    expect(galaxy[col(s, "Reps")]).toBe(2);
    expect(galaxy[col(s, "Top Rep")]).toBe("Amina");
    expect(galaxy[col(s, "Reps Who Sold")]).toBe("Amina (85.7%), Brian (14.3%)");
    expect(galaxy[col(s, "Months Sold")]).toBe(2);
    // prior-year comparison
    expect(galaxy[col(s, "Prior-Year Revenue")]).toBe(1000);
    expect(galaxy[col(s, "YoY Growth %")]).toBe(250);
    // a negative-margin line keeps its sign
    expect(s.rows[1][col(s, "Margin %")]).toBe(r1(-10, 500));
    // no prior year: blank growth, not a made-up figure
    expect(s.rows[2][col(s, "YoY Growth %")]).toBe("");
  });

  it("names the month and year and splits value by month with contribution of the month", () => {
    const s = sheet(extract.sheets, "Brand by Month");
    const galaxySep = s.rows.find((r) => r[col(s, "Brand / Product")] === "Galaxy 40g" && r[col(s, "Period")] === "2026-09")!;
    expect(galaxySep[col(s, "Month")]).toBe("September");
    expect(galaxySep[col(s, "Year")]).toBe(2026);
    expect(galaxySep[col(s, "Revenue (Value)")]).toBe(1500);
    expect(galaxySep[col(s, "Contribution % of Month")]).toBe(100); // September holds only Galaxy
    expect(galaxySep[col(s, "Reps Who Sold")]).toBe("Amina (66.7%), Brian (33.3%)");
    // chronological order
    const periods = s.rows.map((r) => r[col(s, "Period")]);
    expect(periods).toEqual([...periods].sort());
  });

  it("shows each rep's share of a product", () => {
    const s = sheet(extract.sheets, "Brand by Rep");
    const amina = s.rows.find((r) => r[col(s, "Brand / Product")] === "Galaxy 40g" && r[col(s, "Sales Rep")] === "Amina")!;
    expect(amina[col(s, "Rank in Brand")]).toBe(1);
    expect(amina[col(s, "Contribution % of Brand")]).toBe(85.7);
    expect(amina[col(s, "Months Sold")]).toBe(2);
  });

  it("keeps raw data at month, product, rep and customer grain, merging repeated rows", () => {
    const s = sheet(extract.sheets, "Raw Data");
    expect(extract.rawRowCount).toBe(5); // six input rows, two of them the same key
    const bounty = s.rows.find((r) => r[col(s, "Brand / Product")] === "Bounty 57g")!;
    expect(bounty[col(s, "Cases (Volume)")]).toBe(5);
    expect(bounty[col(s, "Revenue (Value)")]).toBe(500);
    expect(bounty[col(s, "Gross Profit")]).toBe(-10);
    expect(bounty[col(s, "Customer")]).toBe("Naivas Westlands");
    // the raw sheet adds up to the total
    expect(s.rows.reduce((sum, r) => sum + (r[col(s, "Revenue (Value)")] as number), 0)).toBe(totalRevenue);
  });

  it("is empty but well formed when there are no rows", () => {
    const empty = buildBrandExtract({ currentRows: [], priorYearRows: [] }, scope);
    expect(empty.rawRowCount).toBe(0);
    expect(sheet(empty.sheets, "Brand Performance").rows).toEqual([]);
    expect(sheet(empty.sheets, "Summary").rows.find((r) => r[0] === "Months with sales")?.[1]).toBe("None");
  });
});

describe("buildCustomerExtract", () => {
  const extract = buildCustomerExtract({ currentRows: current, priorYearRows: priorYear }, scope);

  it("has the summary, the analysis sheets and the raw data, with the tier notes", () => {
    expect(extract.sheets.map((s) => s.name)).toEqual(["Summary", "Customer Ranking", "Customer by Month", "Customer by Brand", "Customer by Rep", "Raw Data"]);
    expect(sheet(extract.sheets, "Summary").rows.some((r) => r[0] === "Tier")).toBe(true);
  });

  it("ranks customers with the page's own tier, contribution and growth, matching names that differ only in case or spacing", () => {
    const s = sheet(extract.sheets, "Customer Ranking");
    expect(s.rows).toHaveLength(2); // "Naivas Westlands" and "NAIVAS WESTLANDS" are one customer; the double space in Quickmart is collapsed
    const portfolio = summarizeCustomerPortfolio({ currentRows: current, latestMonthRows: [], previousMonthRows: [], priorYearRows: priorYear });
    s.rows.forEach((r, i) => {
      const c = portfolio.customers[i];
      expect(r[col(s, "Rank")]).toBe(c.rank);
      expect(r[col(s, "Tier")]).toBe(c.tier);
      expect(r[col(s, "Revenue (Value)")]).toBe(Math.round(c.revenue * 100) / 100);
    });
    const naivas = s.rows[0];
    expect(naivas[col(s, "Customer")]).toBe("Naivas Westlands");
    expect(naivas[col(s, "Revenue (Value)")]).toBe(3500);
    expect(naivas[col(s, "Principal(s)")]).toBe("Mars-Nairobi");
    expect(naivas[col(s, "Products Bought")]).toBe(2);
    expect(naivas[col(s, "Reps Who Sold")]).toBe("Amina (100%)");
    expect(naivas[col(s, "Months Active")]).toBe(2);
    expect(naivas[col(s, "First Purchase")]).toBe("September 2026");
    expect(naivas[col(s, "Last Purchase")]).toBe("October 2026");
    expect(naivas[col(s, "Contribution %")]).toBe(r1(3500, totalRevenue));
    expect(naivas[col(s, "Avg Monthly Revenue")]).toBe(1750);
    expect(naivas[col(s, "Prior-Year Revenue")]).toBe(1000);
    expect(naivas[col(s, "YoY Growth %")]).toBe(250);
    // Quickmart buys from two principals
    expect(s.rows[1][col(s, "Principal(s)")]).toBe("Mars-Nairobi, Suntory-Nairobi");
  });

  it("splits each customer by month, brand and rep with their contribution", () => {
    const byMonth = sheet(extract.sheets, "Customer by Month");
    const oct = byMonth.rows.find((r) => r[col(byMonth, "Customer")] === "Naivas Westlands" && r[col(byMonth, "Period")] === "2026-10")!;
    expect(oct[col(byMonth, "Month")]).toBe("October");
    expect(oct[col(byMonth, "Revenue (Value)")]).toBe(2500);
    expect(oct[col(byMonth, "Contribution % of Month")]).toBe(r1(2500, 2000 + 400 + 100 + 800));

    const byBrand = sheet(extract.sheets, "Customer by Brand");
    const galaxy = byBrand.rows.find((r) => r[col(byBrand, "Customer")] === "Naivas Westlands" && r[col(byBrand, "Brand / Product")] === "Galaxy 40g")!;
    expect(galaxy[col(byBrand, "Contribution % of Customer")]).toBe(r1(3000, 3500));

    const byRep = sheet(extract.sheets, "Customer by Rep");
    expect(byRep.rows.find((r) => r[col(byRep, "Customer")] === "Quickmart Kilimani" && r[col(byRep, "Sales Rep")] === "Brian")![col(byRep, "Contribution % of Customer")]).toBe(r1(500, 1300));
  });

  it("puts the customer first in the raw data", () => {
    const s = sheet(extract.sheets, "Raw Data");
    expect(s.columns.slice(0, 5)).toEqual(["Month", "Year", "Period", "Customer", "Principal"]);
    expect(extract.rawRowCount).toBe(5);
  });
});

describe("trimLargeExtract", () => {
  it("leaves a normal extract alone", () => {
    const extract = buildCustomerExtract({ currentRows: current, priorYearRows: priorYear }, scope);
    expect(trimLargeExtract(extract)).toBe(extract);
  });

  it("drops the row-level sheets past the limit and says so in the Summary", () => {
    const extract = buildCustomerExtract({ currentRows: current, priorYearRows: priorYear }, scope);
    const trimmed = trimLargeExtract(extract, 3);
    expect(trimmed.sheets.map((s) => s.name)).toEqual(["Summary", "Customer Ranking", "Customer by Month", "Customer by Rep"]);
    const note = sheet(trimmed.sheets, "Summary").rows.find((r) => r[0] === "Not included")?.[1] as string;
    expect(note).toContain("Customer by Brand and Raw Data");
    expect(note).toContain("5 raw rows");
    expect(trimmed.rawRowCount).toBe(5);
    const brands = trimLargeExtract(buildBrandExtract({ currentRows: current, priorYearRows: priorYear }, scope), 3);
    expect(brands.sheets.map((s) => s.name)).toEqual(["Summary", "Brand Performance", "Brand by Month", "Brand by Rep"]);
  });
});

describe("extractToXlsxBuffer", () => {
  it("writes a real workbook whose sheets, numbers and formats read back", () => {
    const extract = buildBrandExtract({ currentRows: current, priorYearRows: priorYear }, scope);
    const wb = XLSX.read(extractToXlsxBuffer(extract.sheets), { type: "buffer", cellNF: true });
    expect(wb.SheetNames).toEqual(["Summary", "Brand Performance", "Brand by Month", "Brand by Rep", "Raw Data"]);
    const ws = wb.Sheets["Brand Performance"];
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });
    expect(aoa[0][0]).toBe("Principal");
    expect(aoa[1][aoa[0].indexOf("Revenue (Value)")]).toBe(3500);
    expect(ws["!autofilter"]).toBeTruthy();
    expect(ws[XLSX.utils.encode_cell({ r: 1, c: aoa[0].indexOf("Revenue (Value)") })].z).toBe("#,##0.00");
    expect(ws[XLSX.utils.encode_cell({ r: 1, c: aoa[0].indexOf("Margin %") })].z).toBe("0.0");
  });
});

describe("Customers & Brands report", () => {
  it("builds from the on-demand portfolio the page uses, not the (empty) in-browser dataset", async () => {
    const portfolio = summarizeCustomerPortfolio({ currentRows: current, latestMonthRows: [], previousMonthRows: [], priorYearRows: priorYear });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ portfolio }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const def = REPORT_DEFINITIONS.find((d) => d.key === "customers")!;
      const report = await def.build({ dataset: null, period: { kind: "YTD", year: "2026", month: "October" }, principalKey: "mars", repFilter: null, periodLabel: "YTD October 2026" });
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain("/api/customer-portfolio?");
      expect(url).toContain("principal=mars");
      expect(url).toContain("period=2026-10");
      expect(url).toContain("priorYearPeriod=2025-10");
      expect(report.sections.map((s) => s.title)).toEqual(["Customer Ranking", "Brands & Products", "By Principal"]);
      expect(report.sections[0].rows).toHaveLength(2);
      expect(report.sections[0].rows[0][1]).toBe("Naivas Westlands");
      expect(report.sections[1].rows.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function r1(part: number, whole: number): number {
  return Math.round((part / whole) * 1000) / 10;
}

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { summarizeCustomerPortfolio } from "../lib/customerPortfolio";
import { missingSfaPeriods, onlyPrincipals, sfaDocumentsToPortfolioRows, sfaOutletKey, sfaOutletRowsToPortfolioRows, type SfaDocumentRow, type SfaOutletRow } from "../lib/sfaPortfolio";
import { buildSfaCustomerExtract } from "../lib/sfaCustomerExtract";
import { trimLargeExtract, type ExtractSheet } from "../lib/brandCustomerExtract";
import { extractToXlsxBuffer } from "../lib/extractWorkbook";
import type { MonthlyBrandCustomerRow } from "../lib/types";

function outlet(over: Partial<SfaOutletRow>): SfaOutletRow {
  return {
    year: "2026", monthIndex: 8, principal: "Mars-Nairobi", cardCode: "C001", accountName: "Cash Customer - Risper", sfaCustomer: "Carol Mpesa Shop", sfaContact: "",
    slpCode: 1, repName: "Amina", docCount: 2, cases: 10, revenue: 1000, grossProfit: 150, ...over,
  };
}

const scope = { principalLabel: "All principals", periodLabel: "YTD October 2026", generatedAt: new Date("2026-10-08T06:00:00Z") };

const current: SfaOutletRow[] = [
  // two outlets behind one shared billing account
  outlet({ sfaCustomer: "Carol Mpesa Shop", sfaContact: "+254720045344", monthIndex: 8, revenue: 3000, cases: 30, grossProfit: 450, repName: "Amina", docCount: 3 }),
  outlet({ sfaCustomer: "Benann Supermarket", monthIndex: 8, revenue: 1000, cases: 10, grossProfit: 100, repName: "Brian", docCount: 1 }),
  // the same outlet next month, spelt with different punctuation and case, selling a second principal
  outlet({ sfaCustomer: "CAROL  MPESA-SHOP", monthIndex: 9, revenue: 2000, cases: 20, grossProfit: 300, repName: "Amina", docCount: 2 }),
  outlet({ sfaCustomer: "Carol Mpesa Shop", principal: "Suntory-Nairobi", monthIndex: 9, revenue: 500, cases: 5, grossProfit: 40, repName: "Cheng", docCount: 1 }),
  // an outlet whose SFA name was blank: the billing account stands in
  outlet({ cardCode: "C002", accountName: "Junior Wholesaler", sfaCustomer: "Junior Wholesaler", monthIndex: 9, revenue: 400, cases: 4, grossProfit: 40, repName: "Brian", docCount: 1 }),
];
const prior: SfaOutletRow[] = [outlet({ year: "2025", monthIndex: 9, sfaCustomer: "Carol Mpesa Shop", revenue: 1000, cases: 10, grossProfit: 120 })];
const total = 3000 + 1000 + 2000 + 500 + 400;

const sheet = (sheets: ExtractSheet[], name: string) => sheets.find((s) => s.name === name)!;
const col = (s: ExtractSheet, header: string) => s.columns.indexOf(header);

describe("SFA outlet portfolio rows", () => {
  it("maps outlet rows so the outlet is the customer and the billing account rides along", () => {
    const [row] = sfaOutletRowsToPortfolioRows([outlet({ sfaContact: "+254700000001", docCount: 4 })]);
    expect(row).toMatchObject({ customerName: "Carol Mpesa Shop", accountName: "Cash Customer - Risper", sfaContact: "+254700000001", docCount: 4, salesEmployee: "Amina", principalKey: "mars", month: "September", grossMarginPct: 15 });
  });

  it("maps invoices to dated rows, one document each", () => {
    const doc: SfaDocumentRow = { docDate: new Date("2026-09-12T00:00:00Z"), cardCode: "C001", accountName: "Cash", sfaCustomer: "Shop", sfaContact: "", repName: "Amina", principal: "Mars-Nairobi", cases: 2, netSales: 200, grossProfit: 30 };
    const [row] = sfaDocumentsToPortfolioRows([doc]);
    expect(row).toMatchObject({ date: "2026-09-12", year: "2026", monthIndex: 8, customerName: "Shop", revenue: 200, docCount: 1 });
  });

  it("matches outlet names ignoring case, spacing and punctuation", () => {
    expect(sfaOutletKey("CAROL  MPESA-SHOP")).toBe(sfaOutletKey("Carol Mpesa Shop"));
    expect(sfaOutletKey("Kamau Shop")).not.toBe(sfaOutletKey("Kamau Shops"));
  });

  it("limits outlet rows to the principals the dashboard carries, so customer figures match the headlines", () => {
    const rows = [outlet({ principal: "Mars-Nairobi", revenue: 100 }), outlet({ principal: "Nestle-Nairobi", revenue: 900 }), outlet({ principal: "Suntory-Nairobi", revenue: 50 })];
    const kept = onlyPrincipals(rows, new Set(["Mars-Nairobi", "Suntory-Nairobi"]));
    expect(kept.map((r) => r.principal)).toEqual(["Mars-Nairobi", "Suntory-Nairobi"]);
    expect(onlyPrincipals(rows, new Set())).toEqual([]);
  });

  it("reports the requested months no row covers", () => {
    const rows = [{ year: "2026", monthIndex: 8 }];
    expect(missingSfaPeriods([{ year: "2026", monthIndex: 8 }, { year: "2026", monthIndex: 9 }, { year: "2026", monthIndex: 9 }], rows)).toEqual(["2026-10"]);
    expect(missingSfaPeriods([{ year: "2026", monthIndex: 8 }], rows)).toEqual([]);
  });
});

describe("summarizeCustomerPortfolio with SFA outlets", () => {
  const rows = sfaOutletRowsToPortfolioRows(current);
  const brandRows: MonthlyBrandCustomerRow[] = [
    { date: "2026-09-01", year: "2026", month: "September", monthIndex: 8, principal: "Mars-Nairobi", principalKey: "mars", brand: "Galaxy 40g", salesEmployee: "Amina", customerName: "Cash Customer - Risper", cases: 3, revenue: 300, grossProfit: 30, grossMarginPct: 10 },
  ];

  it("merges punctuation variants of an outlet, carries accounts, contact, invoices and reps, and ranks by revenue", () => {
    const result = summarizeCustomerPortfolio({ currentRows: rows, latestMonthRows: [], previousMonthRows: [], priorYearRows: sfaOutletRowsToPortfolioRows(prior), customerKey: sfaOutletKey });
    expect(result.customers.map((c) => c.customerName)).toEqual(["Carol Mpesa Shop", "Benann Supermarket", "Junior Wholesaler"]);
    const carol = result.customers[0];
    expect(carol).toMatchObject({ revenue: 5500, contact: "+254720045344", accounts: ["Cash Customer - Risper"], invoices: 6, reps: 2, priorYearRevenue: 1000, yoyGrowthPct: 450 });
    expect(carol.principals).toEqual(["Mars-Nairobi", "Suntory-Nairobi"]);
    expect(result.totals.customerCount).toBe(3);
    expect(result.totals.revenue).toBe(total);
  });

  it("without the outlet key the punctuation variant stays a separate customer (the account-level rule)", () => {
    const result = summarizeCustomerPortfolio({ currentRows: rows, latestMonthRows: [], previousMonthRows: [], priorYearRows: [] });
    expect(result.totals.customerCount).toBe(4);
  });

  it("takes the brand and product breakdown from the item-level rows when given", () => {
    const result = summarizeCustomerPortfolio({ currentRows: rows, latestMonthRows: [], previousMonthRows: [], priorYearRows: [], customerKey: sfaOutletKey, brandRows });
    expect(result.brands).toHaveLength(1);
    expect(result.brands[0]).toMatchObject({ name: "Galaxy 40g", revenue: 300, contributionPct: 100 });
  });

  it("leaves the existing SAP-account behaviour untouched by default", () => {
    const result = summarizeCustomerPortfolio({ currentRows: brandRows, latestMonthRows: [], previousMonthRows: [], priorYearRows: [] });
    expect(result.customers[0]).not.toHaveProperty("accounts");
    expect(result.customers[0]).not.toHaveProperty("invoices");
    expect(result.customers[0].brandCount).toBe(1);
  });
});

describe("buildSfaCustomerExtract", () => {
  const extract = buildSfaCustomerExtract({ currentRows: current, priorYearRows: prior }, scope);

  it("has the summary, analysis sheets, billing accounts and the raw data", () => {
    expect(extract.sheets.map((s) => s.name)).toEqual(["Summary", "Customer Ranking", "Customer by Month", "Customer by Principal", "Customer by Rep", "Billing Accounts", "Raw Data"]);
    const summary = sheet(extract.sheets, "Summary");
    const get = (label: string) => summary.rows.find((r) => r[0] === label)?.[1];
    expect(get("Customers (SFA outlets)")).toBe(3);
    expect(get("SAP billing accounts")).toBe(2);
    expect(get("Revenue (value)")).toBe(total);
    expect(get("Months with sales")).toBe("September 2026, October 2026");
  });

  it("ranks SFA outlets with contact, billing account, name source, tier, reps and growth", () => {
    const s = sheet(extract.sheets, "Customer Ranking");
    expect(s.rows).toHaveLength(3); // the punctuation variant is the same outlet
    const carol = s.rows[0];
    expect(carol[col(s, "SFA Customer")]).toBe("Carol Mpesa Shop");
    expect(carol[col(s, "SFA Contact")]).toBe("+254720045344");
    expect(carol[col(s, "Billing Account(s)")]).toBe("Cash Customer - Risper");
    expect(carol[col(s, "Name Source")]).toBe("SFA");
    expect(carol[col(s, "Principal(s)")]).toBe("Mars-Nairobi, Suntory-Nairobi");
    expect(carol[col(s, "Reps Who Sold")]).toBe("Amina (90.9%), Cheng (9.1%)");
    expect(carol[col(s, "Months Active")]).toBe(2);
    expect(carol[col(s, "First Purchase")]).toBe("September 2026");
    expect(carol[col(s, "Last Purchase")]).toBe("October 2026");
    expect(carol[col(s, "Documents")]).toBe(6);
    expect(carol[col(s, "Revenue (Value)")]).toBe(5500);
    expect(carol[col(s, "Cases (Volume)")]).toBe(55);
    expect(carol[col(s, "Avg Monthly Revenue")]).toBe(2750);
    expect(carol[col(s, "Prior-Year Revenue")]).toBe(1000);
    expect(carol[col(s, "YoY Growth %")]).toBe(450);
    expect(carol[col(s, "Contribution %")]).toBe(Math.round((5500 / total) * 1000) / 10);
    // an outlet whose SFA name was blank says so
    const junior = s.rows.find((r) => r[col(s, "SFA Customer")] === "Junior Wholesaler")!;
    expect(junior[col(s, "Name Source")]).toBe("Account (SFA name blank)");
  });

  it("shows the outlets that sit behind each billing account", () => {
    const s = sheet(extract.sheets, "Billing Accounts");
    const cash = s.rows.find((r) => r[col(s, "Billing Account")] === "Cash Customer - Risper")!;
    expect(cash[col(s, "SFA Outlets")]).toBe(2);
    expect(cash[col(s, "Top Outlet")]).toBe("Carol Mpesa Shop");
    expect(cash[col(s, "Top Outlet Share %")]).toBe(Math.round((5500 / 6500) * 1000) / 10);
    expect(cash[col(s, "Outlets Behind the Account")]).toBe("Carol Mpesa Shop (84.6%), Benann Supermarket (15.4%)");
    expect(cash[col(s, "Revenue (Value)")]).toBe(6500);
  });

  it("splits by month, principal and rep, naming the month and year", () => {
    const month = sheet(extract.sheets, "Customer by Month");
    const oct = month.rows.find((r) => r[col(month, "SFA Customer")] === "Carol Mpesa Shop" && r[col(month, "Period")] === "2026-10")!;
    expect(oct[col(month, "Month")]).toBe("October");
    expect(oct[col(month, "Year")]).toBe(2026);
    expect(oct[col(month, "Revenue (Value)")]).toBe(2500);
    expect(oct[col(month, "Contribution % of Month")]).toBe(Math.round((2500 / 2900) * 1000) / 10);

    const principal = sheet(extract.sheets, "Customer by Principal");
    const suntory = principal.rows.find((r) => r[col(principal, "Principal")] === "Suntory-Nairobi")!;
    expect(suntory[col(principal, "Contribution % of Customer")]).toBe(Math.round((500 / 5500) * 1000) / 10);

    const rep = sheet(extract.sheets, "Customer by Rep");
    expect(rep.rows.find((r) => r[col(rep, "Sales Rep")] === "Brian" && r[col(rep, "SFA Customer")] === "Benann Supermarket")![col(rep, "Contribution % of Customer")]).toBe(100);
  });

  it("keeps the raw rows as held, summing to the total", () => {
    const raw = sheet(extract.sheets, "Raw Data");
    expect(extract.rawRowCount).toBe(5);
    expect(raw.rows.reduce((sum, r) => sum + (r[col(raw, "Revenue (Value)")] as number), 0)).toBe(total);
    expect(raw.rows.find((r) => r[col(raw, "SFA Contact")] === "+254720045344")![col(raw, "Billing Account")]).toBe("Cash Customer - Risper");
  });

  it("leaves growth blank, and says why, when last year is not loaded at outlet level", () => {
    const noPrior = buildSfaCustomerExtract({ currentRows: current, priorYearRows: null }, scope);
    const s = sheet(noPrior.sheets, "Customer Ranking");
    expect(s.rows[0][col(s, "Prior-Year Revenue")]).toBe("");
    expect(s.rows[0][col(s, "YoY Growth %")]).toBe("");
    expect(sheet(noPrior.sheets, "Summary").rows.find((r) => r[0] === "Prior-year revenue")?.[1]).toContain("not loaded");
  });

  it("keeps the ranking and the billing accounts but drops the row-level sheets past the size limit, and writes a real workbook", () => {
    const trimmed = trimLargeExtract(extract, 3);
    expect(trimmed.sheets.map((s) => s.name)).toEqual(["Summary", "Customer Ranking", "Billing Accounts"]);
    expect(sheet(trimmed.sheets, "Summary").rows.some((r) => r[0] === "Not included")).toBe(true);
    const wb = XLSX.read(extractToXlsxBuffer(extract.sheets), { type: "buffer" });
    expect(wb.SheetNames).toContain("Billing Accounts");
  });
});

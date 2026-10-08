// Detailed Excel extracts for the Customer & Brand Portfolio page (/customers): one for brands and products,
// one for customers. Both are built from the same SAP item-level rows that power the page
// (getLiveBrandCustomerRows: month x principal x product x rep x customer), so a downloaded figure always
// matches what the page shows for the same period and principal filter. Pure functions, no I/O.
//
// Every sheet states the month by name and year, volume (cases) and value (revenue), gross profit and margin,
// the reps who sold, and each line's contribution. The last sheet is the raw data at its natural grain.
import { summarizeCustomerPortfolio } from "./customerPortfolio";
import type { MonthlyBrandCustomerRow } from "./types";

export type ExtractCell = string | number;

export interface ExtractSheet {
  name: string;
  columns: string[];
  rows: ExtractCell[][];
}

export interface ExtractScope {
  principalLabel: string;
  periodLabel: string;
  generatedAt: Date;
}

export interface BrandCustomerExtract {
  sheets: ExtractSheet[];
  /** Counts for the caller's own limits and messages. */
  rawRowCount: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_REPS_LISTED = 10;
const SEP = "\u0001";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const share = (part: number, whole: number): ExtractCell => (whole > 0 ? r1((part / whole) * 100) : "");
const marginOf = (grossProfit: number, revenue: number): ExtractCell => (revenue > 0 ? r1((grossProfit / revenue) * 100) : "");
const perCase = (revenue: number, cases: number): ExtractCell => (cases > 0 ? r2(revenue / cases) : "");
const growthOf = (current: number, prior: number): ExtractCell => (prior > 0 ? r1(((current - prior) / prior) * 100) : "");

const principalOf = (row: MonthlyBrandCustomerRow) => row.principal?.trim() || "Unspecified principal";
const brandOf = (row: MonthlyBrandCustomerRow) => row.brand?.trim() || "Unspecified product";
const repOf = (row: MonthlyBrandCustomerRow) => row.salesEmployee?.trim() || "Unassigned";
const customerDisplay = (row: MonthlyBrandCustomerRow) => (row.customerName ?? "").trim().replace(/\s+/g, " ") || "Unspecified customer";
// Same identity rule as the page's customer ranking: case and repeated spaces only.
const customerKeyOf = (row: MonthlyBrandCustomerRow) => customerDisplay(row).toLocaleUpperCase();
const periodOf = (row: MonthlyBrandCustomerRow) => `${row.year}-${String(row.monthIndex + 1).padStart(2, "0")}`;
const periodLabelOf = (period: string) => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period.slice(5, 7)} ${period.slice(0, 4)}`;

interface Acc {
  cases: number;
  revenue: number;
  grossProfit: number;
  reps: Map<string, number>;
  customers: Set<string>;
  brands: Set<string>;
  principals: Set<string>;
  periods: Set<string>;
  customerName: string;
}

interface Group {
  parts: string[];
  acc: Acc;
}

function newAcc(): Acc {
  return { cases: 0, revenue: 0, grossProfit: 0, reps: new Map(), customers: new Set(), brands: new Set(), principals: new Set(), periods: new Set(), customerName: "" };
}

/** One spelling per customer across every sheet: the first one seen, whitespace collapsed. */
function customerNames(rows: MonthlyBrandCustomerRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const key = customerKeyOf(row);
    if (!names.has(key)) names.set(key, customerDisplay(row));
  }
  return names;
}

function groupRows(rows: MonthlyBrandCustomerRow[], keyOf: (row: MonthlyBrandCustomerRow) => string[], names: Map<string, string>): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const parts = keyOf(row);
    const key = parts.join(SEP);
    let group = groups.get(key);
    if (!group) {
      group = { parts, acc: newAcc() };
      group.acc.customerName = names.get(customerKeyOf(row)) ?? customerDisplay(row);
      groups.set(key, group);
    }
    const acc = group.acc;
    acc.cases += row.cases;
    acc.revenue += row.revenue;
    acc.grossProfit += row.grossProfit;
    const rep = repOf(row);
    acc.reps.set(rep, (acc.reps.get(rep) ?? 0) + row.revenue);
    acc.customers.add(customerKeyOf(row));
    acc.brands.add(brandOf(row));
    acc.principals.add(principalOf(row));
    acc.periods.add(periodOf(row));
  }
  return groups;
}

const byRevenueDesc = (a: Group, b: Group) => b.acc.revenue - a.acc.revenue;

/** "Name (12.3%), Name (8.0%) +2 more": reps by revenue, with each one's share of the group's revenue. */
function repsWhoSold(reps: Map<string, number>): string {
  const total = [...reps.values()].reduce((s, v) => s + v, 0);
  const sorted = [...reps.entries()].sort((a, b) => b[1] - a[1]);
  const listed = sorted.slice(0, MAX_REPS_LISTED).map(([name, revenue]) => (total > 0 ? `${name} (${r1((revenue / total) * 100)}%)` : name));
  const more = sorted.length - MAX_REPS_LISTED;
  return more > 0 ? `${listed.join(", ")} +${more} more` : listed.join(", ");
}

function topRep(reps: Map<string, number>): [string, ExtractCell] {
  const total = [...reps.values()].reduce((s, v) => s + v, 0);
  const sorted = [...reps.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return ["", ""];
  return [sorted[0][0], share(sorted[0][1], total)];
}

function summarySheet(kind: "brands" | "customers", rows: MonthlyBrandCustomerRow[], scope: ExtractScope): ExtractSheet {
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cases = rows.reduce((s, r) => s + r.cases, 0);
  const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
  const periods = [...new Set(rows.map(periodOf))].sort();
  const details: ExtractCell[][] = [
    ["Extract", kind === "brands" ? "Brand and product performance, detailed" : "Customer analysis, detailed"],
    ["Principal", scope.principalLabel],
    ["Period", scope.periodLabel],
    ["Months with sales", periods.map(periodLabelOf).join(", ") || "None"],
    ["Generated", scope.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    [],
    ["Revenue (value)", r2(revenue)],
    ["Cases (volume)", r2(cases)],
    ["Gross profit", r2(grossProfit)],
    ["Gross margin %", marginOf(grossProfit, revenue)],
    ["Brands / products sold", new Set(rows.map((r) => `${principalOf(r)}${SEP}${brandOf(r)}`)).size],
    [kind === "brands" ? "SAP accounts (customers)" : "Customers", new Set(rows.map(customerKeyOf)).size],
    ["Sales reps who sold", new Set(rows.map(repOf)).size],
    [],
    ["Contribution %", "A line's revenue as a percentage of the revenue shown for the same filter (or of its principal, month or customer where the column says so)."],
    ["Reps who sold", "Reps ordered by revenue with their share of that line's revenue, as recorded against the SAP salesperson."],
    ["Source", "SAP invoice lines at item level for the selected principal and period. Revenue, cases and gross profit are the same measures as the page."],
    ["Raw Data sheet", "One row per month, principal, product, rep and customer: the grain every other sheet is summarised from."],
  ];
  if (kind === "customers") {
    details.push(["Tier", "Strategic: the customers making up the first 80% of positive revenue. Growth: the next 15%. Long Tail: the rest. Adjustment: zero or negative revenue."]);
    details.push(["Prior-year revenue", "The same months of the previous year for the same filter; YoY growth compares the full selected period with it."]);
  }
  return { name: "Summary", columns: ["Detail", "Value"], rows: details };
}

function rawSheet(rows: MonthlyBrandCustomerRow[], totalRevenue: number, customerFirst: boolean, names: Map<string, string>): { sheet: ExtractSheet; count: number } {
  const groups = [...groupRows(rows, (r) => [periodOf(r), principalOf(r), brandOf(r), repOf(r), customerKeyOf(r)], names).values()];
  groups.sort((a, b) => a.parts[0].localeCompare(b.parts[0]) || a.parts[1].localeCompare(b.parts[1]) || a.parts[2].localeCompare(b.parts[2]) || a.acc.customerName.localeCompare(b.acc.customerName) || a.parts[3].localeCompare(b.parts[3]));
  const columns = customerFirst
    ? ["Month", "Year", "Period", "Customer", "Principal", "Brand / Product", "Sales Rep", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Revenue per Case", "Contribution % of Total"]
    : ["Month", "Year", "Period", "Principal", "Brand / Product", "Sales Rep", "SAP Account", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Revenue per Case", "Contribution % of Total"];
  const out = groups.map((g) => {
    const [period, principal, brand, rep] = g.parts;
    const year = period.slice(0, 4);
    const month = MONTH_NAMES[Number(period.slice(5, 7)) - 1];
    const { cases, revenue, grossProfit, customerName } = g.acc;
    const tail = [r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), perCase(revenue, cases), share(revenue, totalRevenue)];
    return customerFirst
      ? [month, Number(year), period, customerName, principal, brand, rep, ...tail]
      : [month, Number(year), period, principal, brand, rep, customerName, ...tail];
  });
  return { sheet: { name: "Raw Data", columns, rows: out }, count: out.length };
}

/** Brand and product extract: performance per product, by month, by rep, plus the raw rows. */
export function buildBrandExtract(input: { currentRows: MonthlyBrandCustomerRow[]; priorYearRows: MonthlyBrandCustomerRow[] }, scope: ExtractScope): BrandCustomerExtract {
  const { currentRows, priorYearRows } = input;
  const totalRevenue = currentRows.reduce((s, r) => s + r.revenue, 0);
  const names = customerNames(currentRows);

  const principalRevenue = new Map<string, number>();
  for (const r of currentRows) principalRevenue.set(principalOf(r), (principalRevenue.get(principalOf(r)) ?? 0) + r.revenue);
  const priorByBrand = groupRows(priorYearRows, (r) => [principalOf(r), brandOf(r)], names);

  // Performance per principal and product.
  const brands = [...groupRows(currentRows, (r) => [principalOf(r), brandOf(r)], names).values()];
  brands.sort((a, b) => (principalRevenue.get(b.parts[0]) ?? 0) - (principalRevenue.get(a.parts[0]) ?? 0) || a.parts[0].localeCompare(b.parts[0]) || byRevenueDesc(a, b));
  const rankInPrincipal = new Map<string, number>();
  const performanceRows = brands.map((g) => {
    const [principal, brand] = g.parts;
    const rank = (rankInPrincipal.get(principal) ?? 0) + 1;
    rankInPrincipal.set(principal, rank);
    const { cases, revenue, grossProfit, reps, customers, periods } = g.acc;
    const [top, topShare] = topRep(reps);
    const prior = priorByBrand.get(g.parts.join(SEP))?.acc.revenue ?? 0;
    return [
      principal, brand, rank, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), perCase(revenue, cases),
      share(revenue, principalRevenue.get(principal) ?? 0), share(revenue, totalRevenue), customers.size, reps.size, top, topShare, repsWhoSold(reps), periods.size,
      r2(prior), growthOf(revenue, prior),
    ];
  });

  // By month.
  const monthTotals = new Map<string, number>();
  const monthPrincipalTotals = new Map<string, number>();
  for (const r of currentRows) {
    monthTotals.set(periodOf(r), (monthTotals.get(periodOf(r)) ?? 0) + r.revenue);
    const key = `${periodOf(r)}${SEP}${principalOf(r)}`;
    monthPrincipalTotals.set(key, (monthPrincipalTotals.get(key) ?? 0) + r.revenue);
  }
  const monthly = [...groupRows(currentRows, (r) => [periodOf(r), principalOf(r), brandOf(r)], names).values()];
  monthly.sort((a, b) => a.parts[0].localeCompare(b.parts[0]) || a.parts[1].localeCompare(b.parts[1]) || byRevenueDesc(a, b));
  const monthlyRows = monthly.map((g) => {
    const [period, principal, brand] = g.parts;
    const { cases, revenue, grossProfit, reps, customers } = g.acc;
    return [
      MONTH_NAMES[Number(period.slice(5, 7)) - 1], Number(period.slice(0, 4)), period, principal, brand, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), perCase(revenue, cases),
      share(revenue, monthTotals.get(period) ?? 0), share(revenue, monthPrincipalTotals.get(`${period}${SEP}${principal}`) ?? 0), customers.size, reps.size, repsWhoSold(reps),
    ];
  });

  // By rep within a product.
  const brandRevenue = new Map(brands.map((g) => [g.parts.join(SEP), g.acc.revenue]));
  const repGroups = [...groupRows(currentRows, (r) => [principalOf(r), brandOf(r), repOf(r)], names).values()];
  repGroups.sort((a, b) => (principalRevenue.get(b.parts[0]) ?? 0) - (principalRevenue.get(a.parts[0]) ?? 0) || a.parts[0].localeCompare(b.parts[0]) || (brandRevenue.get(`${b.parts[0]}${SEP}${b.parts[1]}`) ?? 0) - (brandRevenue.get(`${a.parts[0]}${SEP}${a.parts[1]}`) ?? 0) || a.parts[1].localeCompare(b.parts[1]) || byRevenueDesc(a, b));
  const rankInBrand = new Map<string, number>();
  const repRows = repGroups.map((g) => {
    const [principal, brand, rep] = g.parts;
    const brandKey = `${principal}${SEP}${brand}`;
    const rank = (rankInBrand.get(brandKey) ?? 0) + 1;
    rankInBrand.set(brandKey, rank);
    const { cases, revenue, grossProfit, customers, periods } = g.acc;
    return [principal, brand, rep, rank, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, brandRevenue.get(brandKey) ?? 0), share(revenue, totalRevenue), customers.size, periods.size];
  });

  const raw = rawSheet(currentRows, totalRevenue, false, names);
  return {
    rawRowCount: raw.count,
    sheets: [
      summarySheet("brands", currentRows, scope),
      {
        name: "Brand Performance",
        columns: ["Principal", "Brand / Product", "Rank in Principal", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Revenue per Case", "Contribution % of Principal", "Contribution % of Total", "SAP Accounts", "Reps", "Top Rep", "Top Rep Share %", "Reps Who Sold", "Months Sold", "Prior-Year Revenue", "YoY Growth %"],
        rows: performanceRows,
      },
      {
        name: "Brand by Month",
        columns: ["Month", "Year", "Period", "Principal", "Brand / Product", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Revenue per Case", "Contribution % of Month", "Contribution % of Principal in Month", "SAP Accounts", "Reps", "Reps Who Sold"],
        rows: monthlyRows,
      },
      {
        name: "Brand by Rep",
        columns: ["Principal", "Brand / Product", "Sales Rep", "Rank in Brand", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Brand", "Contribution % of Total", "SAP Accounts", "Months Sold"],
        rows: repRows,
      },
      raw.sheet,
    ],
  };
}

/** Customer extract: ranking with tier and growth, by month, by brand, by rep, plus the raw rows. */
export function buildCustomerExtract(input: { currentRows: MonthlyBrandCustomerRow[]; priorYearRows: MonthlyBrandCustomerRow[] }, scope: ExtractScope): BrandCustomerExtract {
  const { currentRows, priorYearRows } = input;
  const totalRevenue = currentRows.reduce((s, r) => s + r.revenue, 0);
  const names = customerNames(currentRows);
  // The tier, contribution, cumulative share and prior-year figures are the page's own: same function, same rows.
  const portfolio = summarizeCustomerPortfolio({ currentRows, latestMonthRows: [], previousMonthRows: [], priorYearRows });
  const keyOfName = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleUpperCase();
  const perCustomer = groupRows(currentRows, (r) => [customerKeyOf(r)], names);

  const rank = new Map<string, number>();
  const rankingRows = portfolio.customers.map((c) => {
    const key = keyOfName(c.customerName);
    rank.set(key, c.rank);
    const acc = perCustomer.get(key)?.acc ?? newAcc();
    const periods = [...acc.periods].sort();
    return [
      c.rank, names.get(keyOfName(c.customerName)) ?? c.customerName, c.tier, c.principals.join(", "), acc.brands.size, repsWhoSold(acc.reps), acc.reps.size, acc.periods.size,
      periods.length > 0 ? periodLabelOf(periods[0]) : "", periods.length > 0 ? periodLabelOf(periods[periods.length - 1]) : "",
      r2(c.cases), r2(c.revenue), r2(c.grossProfit), c.grossMarginPct === null ? "" : r1(c.grossMarginPct),
      c.contributionPct === null ? "" : r1(c.contributionPct), c.cumulativeContributionPct === null ? "" : r1(c.cumulativeContributionPct),
      acc.periods.size > 0 ? r2(c.revenue / acc.periods.size) : "", r2(c.priorYearRevenue), c.yoyGrowthPct === null ? "" : r1(c.yoyGrowthPct),
    ];
  });

  const monthTotals = new Map<string, number>();
  for (const r of currentRows) monthTotals.set(periodOf(r), (monthTotals.get(periodOf(r)) ?? 0) + r.revenue);
  const rankOf = (customerKey: string) => rank.get(customerKey) ?? Number.MAX_SAFE_INTEGER;

  const monthly = [...groupRows(currentRows, (r) => [periodOf(r), customerKeyOf(r)], names).values()];
  monthly.sort((a, b) => a.parts[0].localeCompare(b.parts[0]) || byRevenueDesc(a, b));
  const monthlyRows = monthly.map((g) => {
    const [period] = g.parts;
    const { cases, revenue, grossProfit, reps, brands, principals, customerName } = g.acc;
    return [
      MONTH_NAMES[Number(period.slice(5, 7)) - 1], Number(period.slice(0, 4)), period, customerName, [...principals].sort().join(", "), brands.size, reps.size, repsWhoSold(reps),
      r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, monthTotals.get(period) ?? 0),
    ];
  });

  const customerRevenue = new Map([...perCustomer.entries()].map(([key, g]) => [key, g.acc.revenue]));
  const brandGroups = [...groupRows(currentRows, (r) => [customerKeyOf(r), principalOf(r), brandOf(r)], names).values()];
  brandGroups.sort((a, b) => rankOf(a.parts[0]) - rankOf(b.parts[0]) || byRevenueDesc(a, b));
  const brandRows = brandGroups.map((g) => {
    const { cases, revenue, grossProfit, reps, customerName, periods } = g.acc;
    return [rankOf(g.parts[0]), customerName, g.parts[1], g.parts[2], r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, customerRevenue.get(g.parts[0]) ?? 0), share(revenue, totalRevenue), reps.size, periods.size];
  });

  const repGroups = [...groupRows(currentRows, (r) => [customerKeyOf(r), repOf(r)], names).values()];
  repGroups.sort((a, b) => rankOf(a.parts[0]) - rankOf(b.parts[0]) || byRevenueDesc(a, b));
  const repRows = repGroups.map((g) => {
    const { cases, revenue, grossProfit, principals, brands, customerName, periods } = g.acc;
    return [rankOf(g.parts[0]), customerName, g.parts[1], [...principals].sort().join(", "), brands.size, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, customerRevenue.get(g.parts[0]) ?? 0), periods.size];
  });

  const raw = rawSheet(currentRows, totalRevenue, true, names);
  return {
    rawRowCount: raw.count,
    sheets: [
      summarySheet("customers", currentRows, scope),
      {
        name: "Customer Ranking",
        columns: ["Rank", "Customer", "Tier", "Principal(s)", "Products Bought", "Reps Who Sold", "Reps", "Months Active", "First Purchase", "Last Purchase", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution %", "Cumulative %", "Avg Monthly Revenue", "Prior-Year Revenue", "YoY Growth %"],
        rows: rankingRows,
      },
      {
        name: "Customer by Month",
        columns: ["Month", "Year", "Period", "Customer", "Principal(s)", "Products Bought", "Reps", "Reps Who Sold", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Month"],
        rows: monthlyRows,
      },
      {
        name: "Customer by Brand",
        columns: ["Customer Rank", "Customer", "Principal", "Brand / Product", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Customer", "Contribution % of Total", "Reps", "Months Bought"],
        rows: brandRows,
      },
      {
        name: "Customer by Rep",
        columns: ["Customer Rank", "Customer", "Sales Rep", "Principal(s)", "Products Bought", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Customer", "Months Bought"],
        rows: repRows,
      },
      raw.sheet,
    ],
  };
}

/** Above this many raw rows the row-level sheets are left out (see trimLargeExtract). A single large principal (about
 *  30,000 raw rows) still gets everything; an all-principals full year (90,000 to 170,000) does not. */
export const LARGE_EXTRACT_RAW_ROWS = 40_000;
const ROW_LEVEL_SHEETS = new Set(["Raw Data", "Customer by Brand", "Customer by Month", "Customer by Principal", "Customer by Rep"]);

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** An all-principals, full-year selection runs to tens of thousands of customers and rows: a workbook of that size
 *  (well over 100 MB) is too heavy to build in the app and to download. Past the limit the extract keeps the summary,
 *  the ranking and the other roll-up sheets and drops the row-level ones, and the Summary says so, with how to get
 *  them (pick one or more principals, or a shorter period). */
export function trimLargeExtract(extract: BrandCustomerExtract, limit = LARGE_EXTRACT_RAW_ROWS): BrandCustomerExtract {
  if (extract.rawRowCount <= limit) return extract;
  const dropped = extract.sheets.filter((sheet) => ROW_LEVEL_SHEETS.has(sheet.name)).map((sheet) => sheet.name);
  const sheets = extract.sheets
    .filter((sheet) => !ROW_LEVEL_SHEETS.has(sheet.name))
    .map((sheet) =>
      sheet.name === "Summary"
        ? { ...sheet, rows: [...sheet.rows, [], ["Not included", `${listNames(dropped)}: this selection has ${extract.rawRowCount.toLocaleString("en-US")} raw rows, over the ${limit.toLocaleString("en-US")} limit. Choose one or more principals, or a shorter period, to get them.`]] }
        : sheet
    );
  return { ...extract, sheets };
}

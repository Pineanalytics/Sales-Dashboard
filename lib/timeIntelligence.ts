// Period aggregation over the monthly time-series arrays in Dataset. Nothing in
// lib/types.ts is pre-aggregated to a "current" period anymore — which period is
// "current" is a UI selection, resolved here on demand from raw monthly rows.
import type { Dataset, MonthlySalesRow, MonthlyCoverageRow } from "./types";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const CANONICAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type PeriodKind = "MTD" | "MONTH" | "QTD" | "YTD" | "H1" | "H2" | "Q1" | "Q2" | "Q3" | "Q4";

export interface PeriodSelection {
  kind: PeriodKind;
  year: string;
  /** Reference "as of" month — required for MTD/MONTH/QTD/YTD, ignored for H1/H2/Q1-Q4. */
  month?: string;
}

interface MonthRef {
  year: string;
  monthIndex: number;
}

function rowKey(year: string, monthIndex: number): string {
  return `${year}|${monthIndex}`;
}

function periodKeySet(months: MonthRef[]): Set<string> {
  return new Set(months.map((m) => rowKey(m.year, m.monthIndex)));
}

/** Resolves a PeriodSelection into the concrete (year, monthIndex) pairs it covers. */
export function resolvePeriodMonths(selection: PeriodSelection): MonthRef[] {
  const { kind, year } = selection;
  const monthIdx = selection.month !== undefined ? CANONICAL_MONTHS.indexOf(selection.month) : -1;

  switch (kind) {
    case "MTD":
    case "MONTH":
      return monthIdx < 0 ? [] : [{ year, monthIndex: monthIdx }];
    case "QTD": {
      if (monthIdx < 0) return [];
      const quarterStart = Math.floor(monthIdx / 3) * 3;
      const months: MonthRef[] = [];
      for (let m = quarterStart; m <= monthIdx; m++) months.push({ year, monthIndex: m });
      return months;
    }
    case "YTD": {
      if (monthIdx < 0) return [];
      const months: MonthRef[] = [];
      for (let m = 0; m <= monthIdx; m++) months.push({ year, monthIndex: m });
      return months;
    }
    case "H1":
      return [0, 1, 2, 3, 4, 5].map((m) => ({ year, monthIndex: m }));
    case "H2":
      return [6, 7, 8, 9, 10, 11].map((m) => ({ year, monthIndex: m }));
    case "Q1":
      return [0, 1, 2].map((m) => ({ year, monthIndex: m }));
    case "Q2":
      return [3, 4, 5].map((m) => ({ year, monthIndex: m }));
    case "Q3":
      return [6, 7, 8].map((m) => ({ year, monthIndex: m }));
    case "Q4":
      return [9, 10, 11].map((m) => ({ year, monthIndex: m }));
    default:
      return [];
  }
}

export function getAvailableYears(dataset: Dataset): string[] {
  return Array.from(new Set(dataset.monthlySales.map((r) => r.year))).sort();
}

export function getAvailableMonths(dataset: Dataset, year: string): string[] {
  const indices = new Set(dataset.monthlySales.filter((r) => r.year === year).map((r) => r.monthIndex));
  return CANONICAL_MONTHS.filter((_, i) => indices.has(i));
}

/** Default selection for a freshly-loaded dataset: MTD of the latest available month/year. */
export function getDefaultPeriod(dataset: Dataset): PeriodSelection {
  const years = getAvailableYears(dataset);
  const year = years[years.length - 1] ?? "";
  const months = getAvailableMonths(dataset, year);
  const month = months[months.length - 1];
  return { kind: "MTD", year, month };
}

// ---------------------------------------------------------------------------
// Sales vs Target
// ---------------------------------------------------------------------------

export interface PeriodSalesSummary {
  revenue: number;
  target: number | null;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  achievementPct: number | null;
  monthsIncluded: number;
}

function summarizeSalesRows(rows: MonthlySalesRow[], months: MonthRef[]): PeriodSalesSummary {
  const keys = periodKeySet(months);
  const matched = rows.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));
  const monthsWithData = new Set(matched.map((r) => rowKey(r.year, r.monthIndex)));

  let revenue = 0;
  let cogs = 0;
  let grossProfit = 0;
  let targetSum = 0;
  let hasNullTarget = false;
  const monthsWithTarget = new Set<string>();

  for (const r of matched) {
    revenue += r.revenue;
    cogs += r.cogs;
    grossProfit += r.grossProfit;
    if (r.target === null) {
      hasNullTarget = true;
    } else {
      targetSum += r.target;
      monthsWithTarget.add(rowKey(r.year, r.monthIndex));
    }
  }

  // The period's target is only meaningful if every requested month is both present
  // in the data AND has a non-null target — a partial sum must never masquerade as
  // a complete one (this is the invariant the 2025-vs-2026 target split depends on).
  const allMonthsHaveTarget = months.length > 0 && months.every((m) => monthsWithTarget.has(rowKey(m.year, m.monthIndex)));
  const target = !hasNullTarget && allMonthsHaveTarget ? targetSum : null;

  const grossMarginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
  const achievementPct = target !== null && target > 0 ? round1((revenue / target) * 100) : null;

  return { revenue, target, cogs, grossProfit, grossMarginPct, achievementPct, monthsIncluded: monthsWithData.size };
}

export function summarizeSalesForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): PeriodSalesSummary {
  const months = resolvePeriodMonths(selection);
  const rows = principalKey ? dataset.monthlySales.filter((r) => r.principalKey === principalKey) : dataset.monthlySales;
  return summarizeSalesRows(rows, months);
}

export function summarizeSalesByPrincipal(
  dataset: Dataset,
  selection: PeriodSelection
): Map<string, PeriodSalesSummary & { principal: string; principalKey: string }> {
  const months = resolvePeriodMonths(selection);
  const keys = periodKeySet(months);
  const byKey = new Map<string, MonthlySalesRow[]>();
  const displayNameByKey = new Map<string, string>();

  for (const r of dataset.monthlySales) {
    if (!keys.has(rowKey(r.year, r.monthIndex))) continue;
    if (!byKey.has(r.principalKey)) byKey.set(r.principalKey, []);
    byKey.get(r.principalKey)!.push(r);
    if (!displayNameByKey.has(r.principalKey)) displayNameByKey.set(r.principalKey, r.principal);
  }

  const result = new Map<string, PeriodSalesSummary & { principal: string; principalKey: string }>();
  for (const [key, rows] of byKey) {
    result.set(key, { ...summarizeSalesRows(rows, months), principal: displayNameByKey.get(key) ?? key, principalKey: key });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Coverage & Productivity
// ---------------------------------------------------------------------------

export interface PeriodCoverageSummary {
  coverage: number;
  productiveCalls: number;
  productivityPct: number;
  monthsIncluded: number;
}

function summarizeCoverageRows(rows: MonthlyCoverageRow[], months: MonthRef[]): PeriodCoverageSummary {
  const keys = periodKeySet(months);
  const matched = rows.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));
  const monthsWithData = new Set(matched.map((r) => rowKey(r.year, r.monthIndex)));

  const coverage = matched.reduce((s, r) => s + r.coverage, 0);
  const productiveCalls = matched.reduce((s, r) => s + r.productiveCalls, 0);
  const productivityPct = coverage > 0 ? round1((productiveCalls / coverage) * 100) : 0;

  return { coverage, productiveCalls, productivityPct, monthsIncluded: monthsWithData.size };
}

export function summarizeCoverageForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): PeriodCoverageSummary {
  const months = resolvePeriodMonths(selection);
  const rows = principalKey ? dataset.monthlyCoverage.filter((r) => r.principalKey === principalKey) : dataset.monthlyCoverage;
  return summarizeCoverageRows(rows, months);
}

export interface RepCoverageSummary {
  employeeName: string;
  salesRole: string;
  coverage: number;
  productiveCalls: number;
  productivityPct: number;
}

export function summarizeCoverageByRep(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): RepCoverageSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const filtered = dataset.monthlyCoverage.filter(
    (r) => keys.has(rowKey(r.year, r.monthIndex)) && (!principalKey || r.principalKey === principalKey)
  );

  const byRep = new Map<string, { employeeName: string; salesRole: string; coverage: number; productiveCalls: number }>();
  for (const r of filtered) {
    const existing = byRep.get(r.employeeName);
    if (existing) {
      existing.coverage += r.coverage;
      existing.productiveCalls += r.productiveCalls;
    } else {
      byRep.set(r.employeeName, {
        employeeName: r.employeeName,
        salesRole: r.salesRole,
        coverage: r.coverage,
        productiveCalls: r.productiveCalls,
      });
    }
  }

  return Array.from(byRep.values()).map((r) => ({
    ...r,
    productivityPct: r.coverage > 0 ? round1((r.productiveCalls / r.coverage) * 100) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Brand & Customer
// ---------------------------------------------------------------------------

function marginFrom(revenue: number, grossProfit: number): number | null {
  return revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
}

function filterBrandCustomer(dataset: Dataset, selection: PeriodSelection, principalKey: string | null) {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  return dataset.monthlyBrandCustomer.filter(
    (r) => keys.has(rowKey(r.year, r.monthIndex)) && (!principalKey || r.principalKey === principalKey)
  );
}

export interface CustomerSummary {
  customerName: string;
  volume: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export function summarizeBrandCustomerByCustomer(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): CustomerSummary[] {
  const rows = filterBrandCustomer(dataset, selection, principalKey);
  const byCustomer = new Map<string, { customerName: string; volume: number; revenue: number; grossProfit: number }>();
  for (const r of rows) {
    const existing = byCustomer.get(r.customerName);
    if (existing) {
      existing.volume += r.volume;
      existing.revenue += r.revenue;
      existing.grossProfit += r.grossProfit;
    } else {
      byCustomer.set(r.customerName, { customerName: r.customerName, volume: r.volume, revenue: r.revenue, grossProfit: r.grossProfit });
    }
  }
  return Array.from(byCustomer.values()).map((c) => ({ ...c, grossMarginPct: marginFrom(c.revenue, c.grossProfit) }));
}

export interface RepBrandCustomerSummary {
  salesEmployee: string;
  volume: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export function summarizeBrandCustomerByRep(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): RepBrandCustomerSummary[] {
  const rows = filterBrandCustomer(dataset, selection, principalKey);
  const byRep = new Map<string, { salesEmployee: string; volume: number; revenue: number; grossProfit: number }>();
  for (const r of rows) {
    const existing = byRep.get(r.salesEmployee);
    if (existing) {
      existing.volume += r.volume;
      existing.revenue += r.revenue;
      existing.grossProfit += r.grossProfit;
    } else {
      byRep.set(r.salesEmployee, { salesEmployee: r.salesEmployee, volume: r.volume, revenue: r.revenue, grossProfit: r.grossProfit });
    }
  }
  return Array.from(byRep.values()).map((rep) => ({ ...rep, grossMarginPct: marginFrom(rep.revenue, rep.grossProfit) }));
}

export interface PrincipalBrandCustomerSummary {
  principal: string;
  principalKey: string;
  volume: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export function summarizeBrandCustomerByPrincipal(
  dataset: Dataset,
  selection: PeriodSelection
): PrincipalBrandCustomerSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const rows = dataset.monthlyBrandCustomer.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));
  const byPrincipal = new Map<string, { principal: string; principalKey: string; volume: number; revenue: number; grossProfit: number }>();
  for (const r of rows) {
    const existing = byPrincipal.get(r.principalKey);
    if (existing) {
      existing.volume += r.volume;
      existing.revenue += r.revenue;
      existing.grossProfit += r.grossProfit;
    } else {
      byPrincipal.set(r.principalKey, {
        principal: r.principal,
        principalKey: r.principalKey,
        volume: r.volume,
        revenue: r.revenue,
        grossProfit: r.grossProfit,
      });
    }
  }
  return Array.from(byPrincipal.values()).map((p) => ({ ...p, grossMarginPct: marginFrom(p.revenue, p.grossProfit) }));
}

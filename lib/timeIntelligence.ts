// Period aggregation over the monthly time-series arrays in Dataset. Nothing in
// lib/types.ts is pre-aggregated to a "current" period anymore — which period is
// "current" is a UI selection, resolved here on demand from raw monthly rows.
//
// Principal selection grain: the app-wide "selected principal" is the raw Principal
// string (e.g. "EABL-Nyeri"), not the normalized brand key — so same-brand,
// different-location principals (e.g. "EABL-Nyeri" vs "EABL-Nyahururu") list and
// filter as distinct entries on the sales side (Sales vs Target, Brand & Customer).
// Stock and Coverage & Productivity have no reliable location split in their source
// sheets, so they intentionally stay rolled up by normalized brand key — their
// summarize functions below normalize an incoming raw principal string before
// matching, so selecting either location still shows the same combined figures.
import type { Dataset, MonthlySalesRow, MonthlyCoverageRow } from "./types";
import { normalizePrincipalKey } from "./normalize";

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

/** MTD anchored to the real calendar month (not just whatever month the data happens to end
 *  on — the sheet can carry future months that already have a target populated, e.g. December
 *  entered ahead of time in July). Falls back to the latest month actually present in the
 *  dataset if today's real year/month isn't there yet. */
export function getCurrentMonthPeriod(dataset: Dataset): PeriodSelection {
  const years = getAvailableYears(dataset);
  if (years.length === 0) return { kind: "MTD", year: "", month: undefined };

  const now = new Date();
  const realYear = String(now.getFullYear());
  const realMonth = CANONICAL_MONTHS[now.getMonth()];

  if (years.includes(realYear) && getAvailableMonths(dataset, realYear).includes(realMonth)) {
    return { kind: "MTD", year: realYear, month: realMonth };
  }

  const year = years[years.length - 1];
  const months = getAvailableMonths(dataset, year);
  const month = months[months.length - 1];
  return { kind: "MTD", year, month };
}

/** Default selection for a freshly-loaded dataset. */
export function getDefaultPeriod(dataset: Dataset): PeriodSelection {
  return getCurrentMonthPeriod(dataset);
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
  let hasAnyTarget = false;

  for (const r of matched) {
    revenue += r.revenue;
    cogs += r.cogs;
    grossProfit += r.grossProfit;
    if (r.target !== null) {
      targetSum += r.target;
      hasAnyTarget = true;
    }
  }

  // Target is null only when there is truly zero target data anywhere in the
  // matched rows (e.g. all of 2025) — the invariant that must never be broken is
  // "never fabricate a number when there's no data at all." It deliberately does
  // NOT go back to null just because one row among many (e.g. a single principal
  // not yet targeted for a given month) lacks one; summing whatever targets exist
  // is far more useful than blanking the whole period over one row's gap.
  const target = hasAnyTarget ? targetSum : null;

  const grossMarginPct = revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
  const achievementPct = target !== null && target > 0 ? round1((revenue / target) * 100) : null;

  return { revenue, target, cogs, grossProfit, grossMarginPct, achievementPct, monthsIncluded: monthsWithData.size };
}

/** `principalKey` here is the raw Principal string (e.g. "EABL-Nyeri"), matched exactly —
 *  sales are location-granular, not rolled up by brand. */
export function summarizeSalesForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): PeriodSalesSummary {
  const months = resolvePeriodMonths(selection);
  const rows = principalKey ? dataset.monthlySales.filter((r) => r.principal === principalKey) : dataset.monthlySales;
  return summarizeSalesRows(rows, months);
}

/** Groups by the raw Principal string, not the normalized brand key, so same-brand
 *  different-location principals (e.g. "EABL-Nyeri"/"EABL-Nyahururu") list separately. */
export function summarizeSalesByPrincipal(
  dataset: Dataset,
  selection: PeriodSelection
): Map<string, PeriodSalesSummary & { principal: string; principalKey: string }> {
  const months = resolvePeriodMonths(selection);
  const keys = periodKeySet(months);
  const byKey = new Map<string, MonthlySalesRow[]>();

  for (const r of dataset.monthlySales) {
    if (!keys.has(rowKey(r.year, r.monthIndex))) continue;
    if (!byKey.has(r.principal)) byKey.set(r.principal, []);
    byKey.get(r.principal)!.push(r);
  }

  const result = new Map<string, PeriodSalesSummary & { principal: string; principalKey: string }>();
  for (const [principal, rows] of byKey) {
    result.set(principal, { ...summarizeSalesRows(rows, months), principal, principalKey: principal });
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

/** The source sheet's SalesRole values are "Primary Sales"/"Secondary Sales" (plus
 *  blank-employee "*Average" pivot rows already filtered out at parse time) — classify
 *  by substring rather than exact match so casing/wording drift doesn't silently drop rows. */
export type RoleCategory = "primary" | "secondary" | "other";

export function classifyRole(salesRole: string): RoleCategory {
  const lower = salesRole.toLowerCase();
  if (lower.includes("primary")) return "primary";
  if (lower.includes("secondary")) return "secondary";
  return "other";
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

/** `principalKey` may be a raw Principal string (e.g. "EABL-Nyeri") or an already-normalized
 *  brand key — normalized either way before matching, since coverage has no reliable
 *  location split and stays rolled up by brand regardless of which location was selected. */
export function summarizeCoverageForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null,
  roleCategory?: RoleCategory
): PeriodCoverageSummary {
  const months = resolvePeriodMonths(selection);
  const brandKey = principalKey ? normalizePrincipalKey(principalKey) : null;
  const rows = dataset.monthlyCoverage.filter(
    (r) => (!brandKey || r.principalKey === brandKey) && (!roleCategory || classifyRole(r.salesRole) === roleCategory)
  );
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
  principalKey: string | null,
  roleCategory?: RoleCategory
): RepCoverageSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const brandKey = principalKey ? normalizePrincipalKey(principalKey) : null;
  const filtered = dataset.monthlyCoverage.filter(
    (r) =>
      keys.has(rowKey(r.year, r.monthIndex)) &&
      (!brandKey || r.principalKey === brandKey) &&
      (!roleCategory || classifyRole(r.salesRole) === roleCategory)
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

export interface RepPrincipalCoverageSummary {
  principal: string;
  principalKey: string;
  coverage: number;
  productiveCalls: number;
  productivityPct: number;
}

/** One rep's coverage broken down by principal, ignoring any principal-filter scope —
 *  used to answer "how is this specific rep doing across every brand they serve." */
export function summarizeCoverageByRepAcrossPrincipals(
  dataset: Dataset,
  selection: PeriodSelection,
  employeeName: string
): RepPrincipalCoverageSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const filtered = dataset.monthlyCoverage.filter((r) => keys.has(rowKey(r.year, r.monthIndex)) && r.employeeName === employeeName);

  const byPrincipal = new Map<string, { principal: string; principalKey: string; coverage: number; productiveCalls: number }>();
  for (const r of filtered) {
    const existing = byPrincipal.get(r.principalKey);
    if (existing) {
      existing.coverage += r.coverage;
      existing.productiveCalls += r.productiveCalls;
    } else {
      byPrincipal.set(r.principalKey, { principal: r.principal, principalKey: r.principalKey, coverage: r.coverage, productiveCalls: r.productiveCalls });
    }
  }

  return Array.from(byPrincipal.values()).map((p) => ({
    ...p,
    productivityPct: p.coverage > 0 ? round1((p.productiveCalls / p.coverage) * 100) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Brand & Customer
// ---------------------------------------------------------------------------

function marginFrom(revenue: number, grossProfit: number): number | null {
  return revenue > 0 ? round1((grossProfit / revenue) * 100) : null;
}

/** `principalKey` is the raw Principal string, matched exactly — Brand & Customer is
 *  location-granular like Sales vs Target, not rolled up by brand. */
function filterBrandCustomer(dataset: Dataset, selection: PeriodSelection, principalKey: string | null) {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  return dataset.monthlyBrandCustomer.filter(
    (r) => keys.has(rowKey(r.year, r.monthIndex)) && (!principalKey || r.principal === principalKey)
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

/** Groups by the raw Principal string so same-brand different-location principals
 *  show as distinct slices/rows, matching the rest of the sales side. */
export function summarizeBrandCustomerByPrincipal(
  dataset: Dataset,
  selection: PeriodSelection
): PrincipalBrandCustomerSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const rows = dataset.monthlyBrandCustomer.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));
  const byPrincipal = new Map<string, { principal: string; principalKey: string; volume: number; revenue: number; grossProfit: number }>();
  for (const r of rows) {
    const existing = byPrincipal.get(r.principal);
    if (existing) {
      existing.volume += r.volume;
      existing.revenue += r.revenue;
      existing.grossProfit += r.grossProfit;
    } else {
      byPrincipal.set(r.principal, {
        principal: r.principal,
        principalKey: r.principal,
        volume: r.volume,
        revenue: r.revenue,
        grossProfit: r.grossProfit,
      });
    }
  }
  return Array.from(byPrincipal.values()).map((p) => ({ ...p, grossMarginPct: marginFrom(p.revenue, p.grossProfit) }));
}

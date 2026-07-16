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
import type { Dataset, MonthlySalesRow, MonthlyCoverageRow, MonthlyPLRow } from "./types";
import { normalizePrincipalKey } from "./normalize";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const CANONICAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type PeriodKind = "MTD" | "MONTH" | "QTD" | "YTD" | "H1" | "H2" | "Q1" | "Q2" | "Q3" | "Q4" | "CUSTOM";

export interface PeriodSelection {
  kind: PeriodKind;
  year: string;
  /** Reference "as of" month — required for MTD/MONTH/QTD/YTD, ignored for H1/H2/Q1-Q4.
   *  For CUSTOM, this is the range's "from" anchor. */
  month?: string;
  /** CUSTOM only — the range's "to" anchor (inclusive). Ignored by every other kind. */
  toYear?: string;
  toMonth?: string;
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
    case "CUSTOM": {
      if (monthIdx < 0 || !selection.toYear || !selection.toMonth) return [];
      const toMonthIdx = CANONICAL_MONTHS.indexOf(selection.toMonth);
      if (toMonthIdx < 0) return [];
      const fromYearNum = Number(year);
      const toYearNum = Number(selection.toYear);
      const months: MonthRef[] = [];
      for (let y = fromYearNum; y <= toYearNum; y++) {
        const startM = y === fromYearNum ? monthIdx : 0;
        const endM = y === toYearNum ? toMonthIdx : 11;
        for (let m = startM; m <= endM; m++) months.push({ year: String(y), monthIndex: m });
      }
      return months;
    }
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

/** The same period one year earlier, for year-over-year comparisons. Valid for
 *  any PeriodKind (MONTH/QTD/YTD/H1/H2/Q1-Q4) — only the year changes, so a
 *  YTD selection compares against last year's YTD through the same month, a
 *  Q2 selection compares against last year's Q2, etc. */
export function getPriorYearPeriod(period: PeriodSelection): PeriodSelection {
  return { ...period, year: String(Number(period.year) - 1) };
}

/** The single calendar month immediately before the given period's "as of"
 *  month, for month-over-month comparisons — handles year rollover (January
 *  rolls back to the prior December). Always resolves to a MONTH-kind period
 *  anchored on a single month, regardless of the input's own kind (a YTD
 *  selection's MoM comparison is still "this month vs last month", not
 *  "this YTD vs last YTD" — that's what getPriorYearPeriod is for). Returns
 *  null if the period has no anchor month (H1/H2/Q1-Q4 have none). */
export function getPreviousMonthPeriod(period: PeriodSelection): PeriodSelection | null {
  if (!period.month) return null;
  const idx = CANONICAL_MONTHS.indexOf(period.month);
  if (idx < 0) return null;
  if (idx === 0) return { kind: "MONTH", year: String(Number(period.year) - 1), month: "December" };
  return { kind: "MONTH", year: period.year, month: CANONICAL_MONTHS[idx - 1] };
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

/** Sums the coverage/productiveCalls of a row set into per-month totals — summing across
 *  reps within the same month is valid (each rep's outlets are additive to the team's
 *  monthly reach), but the month totals themselves must never be summed together, since
 *  coverage counts unique outlets and the same outlets get revisited every month. */
function monthlyCoverageTotals(rows: MonthlyCoverageRow[]): Map<string, { coverage: number; productiveCalls: number }> {
  const byMonth = new Map<string, { coverage: number; productiveCalls: number }>();
  for (const r of rows) {
    const key = rowKey(r.year, r.monthIndex);
    const existing = byMonth.get(key);
    if (existing) {
      existing.coverage += r.coverage;
      existing.productiveCalls += r.productiveCalls;
    } else {
      byMonth.set(key, { coverage: r.coverage, productiveCalls: r.productiveCalls });
    }
  }
  return byMonth;
}

function averageMonthlyTotals(byMonth: Map<string, { coverage: number; productiveCalls: number }>): { coverage: number; productiveCalls: number; monthsIncluded: number } {
  const monthTotals = Array.from(byMonth.values());
  const n = monthTotals.length;
  return {
    coverage: n > 0 ? Math.round(monthTotals.reduce((s, m) => s + m.coverage, 0) / n) : 0,
    productiveCalls: n > 0 ? Math.round(monthTotals.reduce((s, m) => s + m.productiveCalls, 0) / n) : 0,
    monthsIncluded: n,
  };
}

/** Coverage measures unique outlets, not repeated visits — a multi-month period (YTD, H1,
 *  a quarter) reports the AVERAGE of each month's total (itself summed across reps for
 *  that Principal/Month/SalesRole), not a running sum across months. Matches how the
 *  source "Sales Update" workbook computes its own period totals. */
function summarizeCoverageRows(rows: MonthlyCoverageRow[], months: MonthRef[]): PeriodCoverageSummary {
  const keys = periodKeySet(months);
  const matched = rows.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));

  const { coverage, productiveCalls, monthsIncluded } = averageMonthlyTotals(monthlyCoverageTotals(matched));
  const productivityPct = coverage > 0 ? round1((productiveCalls / coverage) * 100) : 0;

  return { coverage, productiveCalls, productivityPct, monthsIncluded };
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

/** Same "average the months, not sum" rule as summarizeCoverageRows, applied per rep —
 *  a rep's own YTD coverage is the average of their monthly totals (summed across any
 *  principals collapsed into the same month), not a running sum across months. This
 *  keeps each rep's figure consistent with the period Total: summing every rep's
 *  (already-averaged) coverage reproduces summarizeCoverageForPeriod's total exactly. */
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

  const byRep = new Map<string, { employeeName: string; salesRole: string; rows: MonthlyCoverageRow[] }>();
  for (const r of filtered) {
    const existing = byRep.get(r.employeeName);
    if (existing) existing.rows.push(r);
    else byRep.set(r.employeeName, { employeeName: r.employeeName, salesRole: r.salesRole, rows: [r] });
  }

  return Array.from(byRep.values()).map((rep) => {
    const { coverage, productiveCalls } = averageMonthlyTotals(monthlyCoverageTotals(rep.rows));
    return {
      employeeName: rep.employeeName,
      salesRole: rep.salesRole,
      coverage,
      productiveCalls,
      productivityPct: coverage > 0 ? round1((productiveCalls / coverage) * 100) : 0,
    };
  });
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

  const byPrincipal = new Map<string, { principal: string; principalKey: string; rows: MonthlyCoverageRow[] }>();
  for (const r of filtered) {
    const existing = byPrincipal.get(r.principalKey);
    if (existing) existing.rows.push(r);
    else byPrincipal.set(r.principalKey, { principal: r.principal, principalKey: r.principalKey, rows: [r] });
  }

  return Array.from(byPrincipal.values()).map((p) => {
    const { coverage, productiveCalls } = averageMonthlyTotals(monthlyCoverageTotals(p.rows));
    return {
      principal: p.principal,
      principalKey: p.principalKey,
      coverage,
      productiveCalls,
      productivityPct: coverage > 0 ? round1((productiveCalls / coverage) * 100) : 0,
    };
  });
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

// ---------------------------------------------------------------------------
// P&L by Cost Centre
// ---------------------------------------------------------------------------

export interface PeriodPLSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  otherIncome: number;
  totalIncome: number;
  expenses: number;
  netProfit: number;
  netMarginPct: number | null;
  monthsIncluded: number;
}

function summarizePLRows(rows: MonthlyPLRow[], months: MonthRef[]): PeriodPLSummary {
  const keys = periodKeySet(months);
  const matched = rows.filter((r) => keys.has(rowKey(r.year, r.monthIndex)));
  const monthsWithData = new Set(matched.map((r) => rowKey(r.year, r.monthIndex)));

  let revenue = 0;
  let cogs = 0;
  let otherIncome = 0;
  let expenses = 0;

  for (const r of matched) {
    if (r.lineType === "REVENUE") revenue += r.amount;
    else if (r.lineType === "COGS") cogs += r.amount;
    else if (r.lineType === "OTHER_INCOME") otherIncome += r.amount;
    else if (r.lineType === "EXPENSE") expenses += r.amount;
  }

  const grossProfit = revenue - cogs;
  const totalIncome = grossProfit + otherIncome;
  const netProfit = totalIncome - expenses;
  const netMarginPct = totalIncome > 0 ? round1((netProfit / totalIncome) * 100) : null;

  return { revenue, cogs, grossProfit, otherIncome, totalIncome, expenses, netProfit, netMarginPct, monthsIncluded: monthsWithData.size };
}

/** `principalKey` here is the raw Principal string (Cost Centre), matched exactly —
 *  same location-granular convention as sales, not rolled up by brand. */
export function summarizePLForPeriod(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): PeriodPLSummary {
  const months = resolvePeriodMonths(selection);
  const rows = principalKey ? dataset.monthlyPL.filter((r) => r.principal === principalKey) : dataset.monthlyPL;
  return summarizePLRows(rows, months);
}

/** Groups by the raw Principal string (Cost Centre) so same-brand different-location
 *  principals list separately, matching the rest of the sales side. */
export function summarizePLByPrincipal(
  dataset: Dataset,
  selection: PeriodSelection
): Map<string, PeriodPLSummary & { principal: string; principalKey: string }> {
  const months = resolvePeriodMonths(selection);
  const keys = periodKeySet(months);
  const byKey = new Map<string, MonthlyPLRow[]>();

  for (const r of dataset.monthlyPL) {
    if (!keys.has(rowKey(r.year, r.monthIndex))) continue;
    if (!byKey.has(r.principal)) byKey.set(r.principal, []);
    byKey.get(r.principal)!.push(r);
  }

  const result = new Map<string, PeriodPLSummary & { principal: string; principalKey: string }>();
  for (const [principal, rows] of byKey) {
    result.set(principal, { ...summarizePLRows(rows, months), principal, principalKey: principal });
  }
  return result;
}

export interface AccountPLSummary {
  accountCode: string;
  accountName: string;
  lineType: MonthlyPLRow["lineType"];
  amount: number;
}

/** Account-level breakdown for the selected period/principal — one row per
 *  distinct Account+LineType, summed across the matched months. */
export function summarizePLByAccount(
  dataset: Dataset,
  selection: PeriodSelection,
  principalKey: string | null
): AccountPLSummary[] {
  const keys = periodKeySet(resolvePeriodMonths(selection));
  const rows = dataset.monthlyPL.filter(
    (r) => keys.has(rowKey(r.year, r.monthIndex)) && (!principalKey || r.principal === principalKey)
  );

  const byAccount = new Map<string, AccountPLSummary>();
  for (const r of rows) {
    const key = `${r.accountCode}|${r.lineType}`;
    const existing = byAccount.get(key);
    if (existing) {
      existing.amount += r.amount;
    } else {
      byAccount.set(key, { accountCode: r.accountCode, accountName: r.accountName, lineType: r.lineType, amount: r.amount });
    }
  }
  return Array.from(byAccount.values());
}

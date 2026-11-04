// The Primary vs Secondary monthly trend: primary sales are the purchases (stock received from suppliers, net of returns and credits), secondary sales are the actual
// monthly sales to customers. Both by month across the selected period, in cases and in value, for the whole selection and for each brand. Pure: no database.
import { normalizePrincipalKey } from "@/lib/normalize";
import { brandOf, matchesPrincipalFilter, type MonthRef, type ReceiptLine } from "./summary";

/** Actual sales of one principal in one month, as the sales actuals store them. */
export interface SecondaryMonthRow {
  year: number;
  monthIndex: number;
  principal: string;
  cases: number;
  value: number;
}

/** One value per month of the period, in the order of `Trend.months`. */
export interface TrendSeries {
  primaryCases: number[];
  primaryValue: number[];
  secondaryCases: number[];
  secondaryValue: number[];
}

export interface TrendBlock extends TrendSeries {
  label: string;
}

export interface Trend {
  months: MonthRef[];
  /** Everything selected (all principals, or the one picked). */
  total: TrendBlock;
  /** Each brand with any primary or secondary activity, largest first. */
  byBrand: TrendBlock[];
}

const monthKey = (m: MonthRef) => `${m.year}|${m.monthIndex}`;
const zeros = (n: number) => Array.from({ length: n }, () => 0);
const emptySeries = (n: number): TrendSeries => ({ primaryCases: zeros(n), primaryValue: zeros(n), secondaryCases: zeros(n), secondaryValue: zeros(n) });
export const sumOf = (values: number[]): number => values.reduce((a, v) => a + v, 0);

/**
 * Primary = saleable-goods receipt lines (empties are left out, as everywhere else in the report); secondary = the sales rows. Both are narrowed to the months and to the Reports page's
 * principal choice the same way, so a principal's two sides always cover the same principal.
 */
export function buildTrend(lines: ReceiptLine[], secondary: SecondaryMonthRow[], months: MonthRef[], principalFilter: string | null): Trend {
  const at = new Map(months.map((m, index) => [monthKey(m), index]));
  const total: TrendBlock = { label: principalFilter ? principalFilter : "All principals", ...emptySeries(months.length) };
  const brands = new Map<string, TrendBlock>();
  const blockFor = (principal: string): TrendBlock => {
    const key = normalizePrincipalKey(principal);
    let block = brands.get(key);
    if (!block) {
      block = { label: brandOf(principal), ...emptySeries(months.length) };
      brands.set(key, block);
    }
    return block;
  };

  for (const l of lines) {
    const index = at.get(monthKey(l));
    if (index === undefined || l.stockClass !== "GOODS" || !matchesPrincipalFilter(l.principal, principalFilter)) continue;
    for (const target of [total, blockFor(l.principal)]) {
      target.primaryCases[index] += l.cases;
      target.primaryValue[index] += l.value;
    }
  }
  for (const r of secondary) {
    const index = at.get(monthKey(r));
    if (index === undefined || !matchesPrincipalFilter(r.principal, principalFilter)) continue;
    for (const target of [total, blockFor(r.principal)]) {
      target.secondaryCases[index] += r.cases;
      target.secondaryValue[index] += r.value;
    }
  }

  const size = (b: TrendBlock) => Math.max(Math.abs(sumOf(b.primaryValue)), Math.abs(sumOf(b.secondaryValue)));
  return { months, total, byBrand: [...brands.values()].sort((a, b) => size(b) - size(a)) };
}

/** Primary as a share of secondary, in percent; null when there are no secondary sales to compare with. */
export const primaryShareOfSecondary = (primary: number, secondary: number): number | null => (Math.abs(secondary) > 1e-9 ? (primary / secondary) * 100 : null);

/** The months that have any activity on either side: what an average over the period is taken across. */
export function activeMonthCount(series: TrendSeries): number {
  let count = 0;
  for (let i = 0; i < series.primaryValue.length; i += 1) {
    if (series.primaryValue[i] !== 0 || series.primaryCases[i] !== 0 || series.secondaryValue[i] !== 0 || series.secondaryCases[i] !== 0) count += 1;
  }
  return count;
}

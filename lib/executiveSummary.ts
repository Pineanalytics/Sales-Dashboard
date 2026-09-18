import type { Dataset } from "./types";
import { resolvePeriodMonths, type PeriodSalesSummary, type PeriodSelection } from "./timeIntelligence";

export interface SalesRunRate {
  daily: number;
  weekly: number;
  monthly: number;
  /** "live" = derived from an in-progress MTD period's elapsed days (more
   *  accurate pacing); "average" = derived from a completed multi-month
   *  period's monthly average (QTD/YTD/H1/H2/quarter/full month). */
  basis: "live" | "average";
}

const AVERAGE_DAYS_PER_MONTH = 30;

/** Daily/weekly/monthly sales pace for the executive summary's run-rate
 *  cards. MTD uses the same elapsed-days pacing already computed for target
 *  pacing (lib/timeIntelligence.ts's MtdTargetPacing) so the run rate agrees
 *  with the target-achievement figure shown alongside it. Any other period
 *  kind falls back to a monthly average over `monthsIncluded`, since there's
 *  no "elapsed days" concept for a period that isn't still in progress.
 *  Returns null when there's no revenue-bearing month to pace from. */
export function computeSalesRunRate(summary: PeriodSalesSummary, selection: PeriodSelection): SalesRunRate | null {
  if (selection.kind === "MTD" && summary.mtdTargetPacing && summary.mtdTargetPacing.elapsedDays > 0) {
    const { elapsedDays, daysInMonth } = summary.mtdTargetPacing;
    const daily = summary.revenue / elapsedDays;
    return { daily, weekly: daily * 7, monthly: daily * daysInMonth, basis: "live" };
  }
  if (summary.monthsIncluded > 0) {
    const monthly = summary.revenue / summary.monthsIncluded;
    const daily = monthly / AVERAGE_DAYS_PER_MONTH;
    return { daily, weekly: daily * 7, monthly, basis: "average" };
  }
  return null;
}

/** No existing stock status tier flags an *excess* — OK/Running Out/Out of
 *  Stock/No Sales Data all skew toward shortage. This is a new threshold,
 *  not a value carried in the source data: an item counts as overstocked
 *  once its cover exceeds this many days, provided it still has a real run
 *  rate to measure against (a zero-run-rate item is "No Sales Data" risk,
 *  a different problem, not overstock). */
export const OVERSTOCK_DAYS_THRESHOLD = 60;

export interface OverstockSummary {
  itemCount: number;
  value: number;
}

function isOverstocked(item: { rrWeekValue: number; daysCover: number }, thresholdDays: number): boolean {
  return item.rrWeekValue > 0 && item.daysCover > thresholdDays;
}

/** Overstock count/value across `dataset.stockItems`, optionally scoped to
 *  one normalized principal key (matches StockItem.key, as used throughout
 *  lib/stock.ts). Pass null for the company-wide total. */
export function computeOverstock(
  dataset: Dataset,
  principalKey: string | null,
  thresholdDays: number = OVERSTOCK_DAYS_THRESHOLD
): OverstockSummary {
  let itemCount = 0;
  let value = 0;
  for (const item of dataset.stockItems) {
    if (principalKey && item.key !== principalKey) continue;
    if (!isOverstocked(item, thresholdDays)) continue;
    itemCount += 1;
    value += item.openingValue;
  }
  return { itemCount, value };
}

/** Order 360 (lib/order360Summary.ts) has its own date-range filter shape,
 *  not a PeriodSelection — it has no principal dimension at all, but it does
 *  have a real date axis. Translates the executive summary's selected
 *  PeriodSelection into the {dateFrom, dateTo} YYYY-MM-DD pair /api/order-360
 *  already accepts, spanning the full first-to-last month the period covers.
 *  Returns null for a period with no resolvable months (e.g. no year set). */
export function periodToDateRange(selection: PeriodSelection): { dateFrom: string; dateTo: string } | null {
  const months = resolvePeriodMonths(selection);
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => (a.year === b.year ? a.monthIndex - b.monthIndex : a.year.localeCompare(b.year)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateFrom = `${first.year}-${pad2(first.monthIndex + 1)}-01`;
  const lastDayOfMonth = new Date(Date.UTC(Number(last.year), last.monthIndex + 1, 0)).getUTCDate();
  const dateTo = `${last.year}-${pad2(last.monthIndex + 1)}-${pad2(lastDayOfMonth)}`;
  return { dateFrom, dateTo };
}

export interface PrincipalOverstock {
  key: string;
  name: string;
  itemCount: number;
  value: number;
}

/** Per-principal overstock breakdown, sorted by value descending, for a
 *  "worst offenders" table. Principal display name mirrors
 *  lib/stock.ts's own convention (the part of the Principal string before
 *  its location suffix, e.g. "EABL-Nyeri" -> "EABL"). */
export function computeOverstockByPrincipal(
  dataset: Dataset,
  thresholdDays: number = OVERSTOCK_DAYS_THRESHOLD
): PrincipalOverstock[] {
  const byKey = new Map<string, PrincipalOverstock>();
  for (const item of dataset.stockItems) {
    if (!isOverstocked(item, thresholdDays)) continue;
    let agg = byKey.get(item.key);
    if (!agg) {
      agg = { key: item.key, name: item.principal.split("-")[0].trim(), itemCount: 0, value: 0 };
      byKey.set(item.key, agg);
    }
    agg.itemCount += 1;
    agg.value += item.openingValue;
  }
  return Array.from(byKey.values()).sort((a, b) => b.value - a.value);
}

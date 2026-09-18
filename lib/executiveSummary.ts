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

export interface ActiveOutletsMonthlyRow {
  year: string;
  monthIndex: number;
  distinctOutlets: number;
}

/** Active Outlets' `distinctOutlets` is a per-month unique-outlet count —
 *  like Coverage (see lib/timeIntelligence.ts's `averageMonthlyTotals`),
 *  summing it across multiple months would double-count any outlet active
 *  in more than one of them, inflating a QTD/YTD figure. This averages
 *  instead, matching the same fix this app already shipped for Coverage
 *  (see summarizeCoverageRows's own comment on why coverage is averaged,
 *  not summed, across months). Rows sharing a (year, monthIndex) — e.g.
 *  separate Primary/Secondary rows from /api/active-outlets's `monthly`
 *  array — are summed together first into that month's total, then those
 *  per-month totals are averaged across however many of the period's
 *  months actually have data. Returns null if none do. */
export function averageActiveOutletsForPeriod(
  monthlyRows: ActiveOutletsMonthlyRow[],
  months: { year: string; monthIndex: number }[]
): number | null {
  const monthKeys = new Set(months.map((m) => `${m.year}|${m.monthIndex}`));
  const perMonthTotal = new Map<string, number>();
  for (const row of monthlyRows) {
    const key = `${row.year}|${row.monthIndex}`;
    if (!monthKeys.has(key)) continue;
    perMonthTotal.set(key, (perMonthTotal.get(key) ?? 0) + row.distinctOutlets);
  }
  if (perMonthTotal.size === 0) return null;
  const total = Array.from(perMonthTotal.values()).reduce((sum, v) => sum + v, 0);
  return Math.round(total / perMonthTotal.size);
}


// Planning and grouping helpers for the batched Brand & Customer sync
// (scripts/db-bridge/brand-customer-sync.ts). Pure functions, no I/O.

export interface TargetMonth {
  year: number;
  monthIndex: number; // 0-11
}

export const monthKey = (year: number | string, monthIndex: number) => `${year}|${monthIndex}`;

/** Parses "YYYY-MM" into a month, or null when malformed. */
export function parseMonthArg(value: string | undefined): TargetMonth | null {
  const match = value?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match ? { year: Number(match[1]), monthIndex: Number(match[2]) - 1 } : null;
}

/** Every month from `from` to `to` inclusive, oldest first. */
export function monthRange(from: TargetMonth, to: TargetMonth): TargetMonth[] {
  const months: TargetMonth[] = [];
  let year = from.year;
  let monthIndex = from.monthIndex;
  while (year < to.year || (year === to.year && monthIndex <= to.monthIndex)) {
    months.push({ year, monthIndex });
    monthIndex += 1;
    if (monthIndex === 12) {
      monthIndex = 0;
      year += 1;
    }
  }
  return months;
}

/** The last `count` months ending at `asOf`, oldest first. */
export function trailingMonths(asOf: Date, count: number): TargetMonth[] {
  const end: TargetMonth = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  const startTotal = end.year * 12 + end.monthIndex - (Math.max(1, count) - 1);
  return monthRange({ year: Math.floor(startTotal / 12), monthIndex: startTotal % 12 }, end);
}

/** One SAP read serves up to two target months: the YTD_Raw query returns the
 *  requested month of the as-of year AND the same month a year earlier. Group
 *  targets by month so each month is read once. The read window is always a
 *  month of the as-of year. */
export interface MonthRead {
  monthIndex: number;
  /** YYYY-MM-DD window within the as-of year. */
  start: string;
  end: string;
  /** Years of that month this read must keep (as-of year and/or the year before). */
  years: number[];
}

export function planMonthReads(targets: TargetMonth[], asOfYear: number): MonthRead[] {
  const byMonth = new Map<number, Set<number>>();
  for (const target of targets) {
    if (target.year !== asOfYear && target.year !== asOfYear - 1) continue;
    const years = byMonth.get(target.monthIndex) ?? new Set<number>();
    years.add(target.year);
    byMonth.set(target.monthIndex, years);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a - b)
    .map(([monthIndex, years]) => {
      const last = new Date(Date.UTC(asOfYear, monthIndex + 1, 0)).getUTCDate();
      const mm = String(monthIndex + 1).padStart(2, "0");
      return { monthIndex, start: `${asOfYear}-${mm}-01`, end: `${asOfYear}-${mm}-${String(last).padStart(2, "0")}`, years: Array.from(years).sort() };
    });
}

/** Splits rows into one batch per (year, monthIndex) so each batch can be
 *  uploaded — and replaced — as a complete month in its own transaction. */
export function groupByMonth<T>(rows: T[], periodOf: (row: T) => TargetMonth): Map<string, { period: TargetMonth; rows: T[] }> {
  const groups = new Map<string, { period: TargetMonth; rows: T[] }>();
  for (const row of rows) {
    const period = periodOf(row);
    const key = monthKey(period.year, period.monthIndex);
    const group = groups.get(key) ?? { period, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return groups;
}

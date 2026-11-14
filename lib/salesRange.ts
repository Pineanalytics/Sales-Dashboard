// Date-range analysis for Sales Performance, built on the SAP daily feed
// (DailySalesActual / DailySalesRepActual / DailyBrandCustomerActual) instead
// of the monthly rollups the period views use. Pure and client-safe: dates are
// "YYYY-MM-DD" strings in Nairobi business days, and all maths is UTC-dated.
import { isKenyaWorkingDay } from "@/lib/kenyaBusinessCalendar";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

export type RangeGroupBy = "day" | "week" | "month";

export interface SalesDateRange {
  from: string;
  to: string;
  groupBy: RangeGroupBy;
}

/** The most days one request may span: two years of daily rows. */
export const MAX_RANGE_DAYS = 731;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** Inclusive day count from `from` to `to`. */
export function daysInRange(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(date);
  return out;
}

/** Monday of the week holding `value` (weeks run Monday–Sunday). */
export function weekStart(value: string): string {
  const day = toDate(value).getUTCDay(); // 0 = Sunday
  return addDays(value, -((day + 6) % 7));
}

export function bucketKey(date: string, groupBy: RangeGroupBy): string {
  if (groupBy === "day") return date;
  if (groupBy === "week") return weekStart(date);
  return date.slice(0, 7);
}

function shortDate(value: string): string {
  return toDate(value).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
}

export function bucketLabel(key: string, groupBy: RangeGroupBy): string {
  if (groupBy === "day") return shortDate(key);
  if (groupBy === "week") return `Wk of ${shortDate(key)}`;
  const [year, month] = key.split("-");
  return `${CANONICAL_MONTHS[Number(month) - 1].slice(0, 3)} ${year}`;
}

/** The buckets covering a range in order, empty ones included, each with the dates of the range it holds. */
export function rangeBuckets(range: SalesDateRange): { key: string; label: string; dates: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const date of eachDate(range.from, range.to)) {
    const key = bucketKey(date, range.groupBy);
    const list = buckets.get(key) ?? [];
    list.push(date);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([key, dates]) => ({ key, label: bucketLabel(key, range.groupBy), dates }));
}

/** The range of the same length that ends the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const length = daysInRange(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** The same calendar dates one year earlier (29 Feb falls back to 28 Feb). */
export function sameDatesLastYear(from: string, to: string): { from: string; to: string } {
  const shift = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  };
  return { from: shift(from), to: shift(to) };
}

export interface MonthlyTargetRow {
  year: string;
  monthIndex: number;
  target: number | null;
}

/** Working days (Mon–Fri, not a Kenyan public holiday) in a calendar month. */
function workingDaysInMonth(year: number, monthIndex: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day++) if (isKenyaWorkingDay(new Date(Date.UTC(year, monthIndex, day)))) count++;
  return count;
}

/** The monthly targets that apply to a set of dates, each month's target pro-rated by the share of its working days
 *  the dates cover. Null when no month in the dates has a target (never invented). */
export function proratedTarget(targets: MonthlyTargetRow[], dates: string[]): number | null {
  const datesByMonth = new Map<string, string[]>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    const list = datesByMonth.get(key) ?? [];
    list.push(date);
    datesByMonth.set(key, list);
  }
  let total = 0;
  let anyTarget = false;
  for (const [key, monthDates] of datesByMonth) {
    const year = Number(key.slice(0, 4));
    const monthIndex = Number(key.slice(5, 7)) - 1;
    const monthTarget = targets
      .filter((row) => Number(row.year) === year && row.monthIndex === monthIndex && row.target !== null)
      .reduce((sum, row) => sum + (row.target ?? 0), 0);
    const hasTarget = targets.some((row) => Number(row.year) === year && row.monthIndex === monthIndex && row.target !== null);
    if (!hasTarget) continue;
    anyTarget = true;
    const monthWorking = workingDaysInMonth(year, monthIndex);
    const covered = monthDates.filter((date) => isKenyaWorkingDay(date)).length;
    total += monthWorking > 0 ? monthTarget * (covered / monthWorking) : 0;
  }
  return anyTarget ? total : null;
}

export interface RangePreset {
  id: string;
  label: string;
  from: string;
  to: string;
  groupBy: RangeGroupBy;
}

/** Quick ranges relative to `today` ("YYYY-MM-DD", Nairobi). */
export function rangePresets(today: string): RangePreset[] {
  const thisWeek = weekStart(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return [
    { id: "today", label: "Today", from: today, to: today, groupBy: "day" },
    { id: "yesterday", label: "Yesterday", from: addDays(today, -1), to: addDays(today, -1), groupBy: "day" },
    { id: "this-week", label: "This week", from: thisWeek, to: today, groupBy: "day" },
    { id: "last-week", label: "Last week", from: addDays(thisWeek, -7), to: addDays(thisWeek, -1), groupBy: "day" },
    { id: "last-7", label: "Last 7 days", from: addDays(today, -6), to: today, groupBy: "day" },
    { id: "last-30", label: "Last 30 days", from: addDays(today, -29), to: today, groupBy: "week" },
    { id: "this-month", label: "This month", from: monthStart, to: today, groupBy: "day" },
    { id: "last-month", label: "Last month", from: lastMonthStart, to: lastMonthEnd, groupBy: "week" },
    { id: "this-quarter", label: "This quarter", from: quarterStart, to: today, groupBy: "week" },
    { id: "ytd", label: "Year to date", from: `${today.slice(0, 4)}-01-01`, to: today, groupBy: "month" },
  ];
}

/** Today in Nairobi as "YYYY-MM-DD". */
export function nairobiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Growth of `current` over `base`, %; null when the base is zero or missing. */
export function growthPct(current: number, base: number | null | undefined): number | null {
  return base && base !== 0 ? ((current - base) / Math.abs(base)) * 100 : null;
}

export interface RangeDailyRow {
  date: string;
  principal: string;
  revenue: number;
  cogs?: number;
  grossProfit: number;
}

export interface RangeTotals {
  revenue: number;
  grossProfit: number;
  /** Gross profit as % of revenue; null when there is no revenue. */
  grossMarginPct: number | null;
}

export function sumRange(rows: RangeDailyRow[]): RangeTotals {
  let revenue = 0;
  let grossProfit = 0;
  for (const row of rows) {
    revenue += row.revenue;
    grossProfit += row.grossProfit;
  }
  return { revenue, grossProfit, grossMarginPct: revenue !== 0 ? (grossProfit / revenue) * 100 : null };
}

/** Revenue and gross profit per bucket of the range (empty buckets included), in order. */
export function seriesByBucket(rows: RangeDailyRow[], range: SalesDateRange): { key: string; label: string; dates: string[]; revenue: number; grossProfit: number }[] {
  const totals = new Map<string, { revenue: number; grossProfit: number }>();
  for (const row of rows) {
    const key = bucketKey(row.date, range.groupBy);
    const entry = totals.get(key) ?? { revenue: 0, grossProfit: 0 };
    entry.revenue += row.revenue;
    entry.grossProfit += row.grossProfit;
    totals.set(key, entry);
  }
  return rangeBuckets(range).map((bucket) => ({ ...bucket, revenue: totals.get(bucket.key)?.revenue ?? 0, grossProfit: totals.get(bucket.key)?.grossProfit ?? 0 }));
}

/** Totals per principal, largest revenue first. */
export function totalsByPrincipal(rows: RangeDailyRow[]): ({ principal: string } & RangeTotals)[] {
  const byPrincipal = new Map<string, RangeDailyRow[]>();
  for (const row of rows) {
    const list = byPrincipal.get(row.principal) ?? [];
    list.push(row);
    byPrincipal.set(row.principal, list);
  }
  return Array.from(byPrincipal.entries())
    .map(([principal, list]) => ({ principal, ...sumRange(list) }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** The dates of a range that a target may cover: up to today, never the future. */
export function targetDates(range: { from: string; to: string }, today: string): string[] {
  const end = range.to < today ? range.to : today;
  return end < range.from ? [] : eachDate(range.from, end);
}

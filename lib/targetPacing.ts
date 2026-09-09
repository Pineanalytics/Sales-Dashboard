import { getWeeksInMonth } from "./weeklyTargets";

export const NAIROBI_TIME_ZONE = "Africa/Nairobi";

export interface PacingActual {
  date: string;
  revenue: number;
}

export interface CalculatedWeeklyTarget {
  weekLabel: string;
  weekStartDate: Date;
  /** Reconciled value: elapsed actuals plus open targets equal the monthly mission. */
  targetValue: number;
  /** Revenue still required in this week at the current working-day run rate. */
  expectedRunRate: number;
  workingDays: number;
}

export interface CalculatedDailyTarget {
  date: Date;
  /** Actual on an elapsed day, or the required run rate on an open workday. */
  targetValue: number;
  isWorkingDay: boolean;
}

export interface TargetPacingMetrics {
  fullMonthTarget: number;
  fullMonthBalance: number;
  mtdActual: number;
  rateOfSale: number | null;
  projection: number | null;
  dailyRunRate: number | null;
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
}

export interface TargetPacingPlan {
  weeklyTargets: CalculatedWeeklyTarget[];
  dailyTargets: CalculatedDailyTarget[];
  metrics: TargetPacingMetrics;
  asOfDate: string;
  isRebalanced: boolean;
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWorkingDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** The dashboard's operational date is Nairobi's calendar date, independent of
 * the browser or server host timezone. */
export function nairobiDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function datesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  for (let value = start.getTime(); value <= end.getTime(); value += 86400000) dates.push(new Date(value));
  return dates;
}

/**
 * Builds a read-only operational plan from an official monthly target. The
 * monthly target is distributed by active working days (Mon-Fri). In a live
 * month, elapsed actuals consume the monthly mission and the remaining balance
 * is spread over the remaining active working days. This makes elapsed actuals
 * plus open daily/weekly targets reconcile to the original monthly target,
 * unless the target has already been exceeded (where a negative target would
 * be misleading, so the required run rate becomes 0).
 */
export function buildTargetPacingPlan({
  year,
  monthIndex,
  monthlyTarget,
  actuals,
  asOf = new Date(),
}: {
  year: number;
  monthIndex: number;
  monthlyTarget: number;
  actuals: PacingActual[];
  asOf?: Date;
}): TargetPacingPlan {
  const asOfDate = nairobiDateKey(asOf);
  const monthStart = utcDate(year, monthIndex, 1);
  const monthEnd = utcDate(year, monthIndex + 1, 0);
  const isLiveMonth = asOfDate >= dateKey(monthStart) && asOfDate <= dateKey(monthEnd);
  const monthDates = datesInRange(monthStart, monthEnd);
  const totalWorkingDays = monthDates.filter(isWorkingDay).length;
  const revenueByDate = new Map<string, number>();
  for (const actual of actuals) {
    if (actual.date >= dateKey(monthStart) && actual.date <= dateKey(monthEnd)) {
      revenueByDate.set(actual.date, (revenueByDate.get(actual.date) ?? 0) + actual.revenue);
    }
  }

  const elapsedDates = isLiveMonth ? monthDates.filter((date) => dateKey(date) <= asOfDate) : monthDates;
  const closedDatesForTarget = isLiveMonth ? monthDates.filter((date) => dateKey(date) < asOfDate) : monthDates;
  const openWorkingDates = isLiveMonth ? monthDates.filter((date) => dateKey(date) >= asOfDate && isWorkingDay(date)) : [];
  const mtdActual = elapsedDates.reduce((sum, date) => sum + (revenueByDate.get(dateKey(date)) ?? 0), 0);
  const closedActual = closedDatesForTarget.reduce((sum, date) => sum + (revenueByDate.get(dateKey(date)) ?? 0), 0);
  const elapsedWorkingDays = isLiveMonth ? elapsedDates.filter(isWorkingDay).length : totalWorkingDays;
  const remainingWorkingDays = isLiveMonth ? openWorkingDates.length : 0;
  const fullMonthBalance = monthlyTarget - mtdActual;
  const remainingBalanceForTarget = monthlyTarget - closedActual;
  const dailyRunRate = isLiveMonth && remainingWorkingDays > 0 ? Math.max(0, remainingBalanceForTarget) / remainingWorkingDays : null;
  const rateOfSale = elapsedWorkingDays > 0 ? mtdActual / elapsedWorkingDays : null;
  const projection = rateOfSale !== null ? rateOfSale * totalWorkingDays : null;
  const standardDailyTarget = totalWorkingDays > 0 ? monthlyTarget / totalWorkingDays : 0;

  const dailyTargets = monthDates.map((date) => {
    const key = dateKey(date);
    const elapsed = isLiveMonth && key < asOfDate;
    const openWorkingDay = isLiveMonth && key >= asOfDate && isWorkingDay(date);
    return {
      date,
      isWorkingDay: isWorkingDay(date),
      targetValue: elapsed ? revenueByDate.get(key) ?? 0 : openWorkingDay ? dailyRunRate ?? 0 : isLiveMonth ? 0 : isWorkingDay(date) ? standardDailyTarget : 0,
    };
  });

  const weeklyTargets = getWeeksInMonth(year, monthIndex).map((week) => {
    const weekEnd = new Date(week.weekStartDate.getTime() + 6 * 86400000);
    const start = new Date(Math.max(week.weekStartDate.getTime(), monthStart.getTime()));
    const end = new Date(Math.min(weekEnd.getTime(), monthEnd.getTime()));
    const dates = datesInRange(start, end);
    const weekKeys = new Set(dates.map(dateKey));
    const targetValue = dailyTargets.filter((target) => weekKeys.has(dateKey(target.date))).reduce((sum, target) => sum + target.targetValue, 0);
    const remainingWeekWorkingDays = isLiveMonth
      ? dates.filter((date) => dateKey(date) >= asOfDate && isWorkingDay(date)).length
      : dates.filter(isWorkingDay).length;
    return {
      weekLabel: week.weekLabel,
      weekStartDate: week.weekStartDate,
      targetValue,
      expectedRunRate: remainingWeekWorkingDays * (dailyRunRate ?? standardDailyTarget),
      workingDays: dates.filter(isWorkingDay).length,
    };
  });

  return {
    weeklyTargets,
    dailyTargets,
    metrics: { fullMonthTarget: monthlyTarget, fullMonthBalance, mtdActual, rateOfSale, projection, dailyRunRate, totalWorkingDays, elapsedWorkingDays, remainingWorkingDays },
    asOfDate,
    isRebalanced: isLiveMonth,
  };
}

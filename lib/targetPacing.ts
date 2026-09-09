import { getWeeksInMonth } from "./weeklyTargets";

export const NAIROBI_TIME_ZONE = "Africa/Nairobi";

export interface PacingActual {
  date: string;
  revenue: number;
}

export interface CalculatedWeeklyTarget {
  weekLabel: string;
  weekStartDate: Date;
  targetValue: number;
}

export interface CalculatedDailyTarget {
  date: Date;
  targetValue: number;
}

export interface TargetPacingPlan {
  weeklyTargets: CalculatedWeeklyTarget[];
  dailyTargets: CalculatedDailyTarget[];
  asOfDate: string;
  isRebalanced: boolean;
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
 * Builds the dashboard-only pacing plan from a principal's official full-month
 * target. Every month starts with an equal target for each real calendar week
 * (including a partial opening/closing week). Once a week has closed, its real
 * sales replace its planned amount and the remaining mission is shared equally
 * across the weeks still open. Inside the live week, closed-day actuals are
 * similarly carried into the days still open.
 *
 * This deliberately derives values at read time: Monthly Target remains the
 * source of truth and no WeeklyTarget/DailyTarget planning records are edited.
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
  const revenueByDate = new Map<string, number>();
  for (const actual of actuals) {
    if (actual.date >= dateKey(monthStart) && actual.date <= dateKey(monthEnd)) {
      revenueByDate.set(actual.date, (revenueByDate.get(actual.date) ?? 0) + actual.revenue);
    }
  }

  const weeks = getWeeksInMonth(year, monthIndex).map((week) => {
    const weekEnd = new Date(week.weekStartDate.getTime() + 6 * 86400000);
    const start = new Date(Math.max(week.weekStartDate.getTime(), monthStart.getTime()));
    const end = new Date(Math.min(weekEnd.getTime(), monthEnd.getTime()));
    return { ...week, dates: datesInRange(start, end) };
  });
  const baseWeeklyTarget = weeks.length > 0 ? monthlyTarget / weeks.length : 0;
  const currentWeekIndex = isLiveMonth
    ? weeks.findIndex((week) => week.dates.some((date) => dateKey(date) === asOfDate))
    : -1;
  const closedWeekRevenue = currentWeekIndex > 0
    ? weeks.slice(0, currentWeekIndex).reduce(
        (total, week) => total + week.dates.reduce((sum, date) => sum + (revenueByDate.get(dateKey(date)) ?? 0), 0),
        0
      )
    : 0;
  const remainingWeeks = currentWeekIndex >= 0 ? weeks.length - currentWeekIndex : 0;
  const rebalancedWeeklyTarget = remainingWeeks > 0 ? (monthlyTarget - closedWeekRevenue) / remainingWeeks : baseWeeklyTarget;

  const weeklyTargets = weeks.map((week, index) => ({
    weekLabel: week.weekLabel,
    weekStartDate: week.weekStartDate,
    targetValue: isLiveMonth && index >= currentWeekIndex ? rebalancedWeeklyTarget : baseWeeklyTarget,
  }));

  const dailyTargets: CalculatedDailyTarget[] = [];
  for (const [index, week] of weeks.entries()) {
    const weeklyTarget = weeklyTargets[index].targetValue;
    const daysBeforeToday = isLiveMonth && index === currentWeekIndex ? week.dates.filter((date) => dateKey(date) < asOfDate) : [];
    const openDays = isLiveMonth && index === currentWeekIndex ? week.dates.filter((date) => dateKey(date) >= asOfDate) : [];
    const currentWeekActual = daysBeforeToday.reduce((sum, date) => sum + (revenueByDate.get(dateKey(date)) ?? 0), 0);
    const openDayTarget = openDays.length > 0 ? Math.max(0, weeklyTarget - currentWeekActual) / openDays.length : 0;
    const ordinaryDayTarget = week.dates.length > 0 ? weeklyTarget / week.dates.length : 0;

    for (const date of week.dates) {
      dailyTargets.push({
        date,
        targetValue: isLiveMonth && index === currentWeekIndex && dateKey(date) >= asOfDate ? openDayTarget : ordinaryDayTarget,
      });
    }
  }

  return { weeklyTargets, dailyTargets, asOfDate, isRebalanced: isLiveMonth };
}

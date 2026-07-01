import type { Dataset, Principal, WeeklyProjectionRow } from "./types";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getYears(dataset: Dataset): string[] {
  return Object.keys(dataset.trendedRevenue.totals).sort();
}

export function seriesForPrincipal(dataset: Dataset, principal: Principal | null): { [year: string]: (number | null)[] } {
  if (!principal) return dataset.trendedRevenue.totals;
  return dataset.trendedRevenue.byPrincipalKey[principal.stockKey] ?? {};
}

export interface LatestPoint {
  year: string;
  monthIndex: number;
  month: string;
  value: number;
  yoy: number | null;
}

export function latestDataPoint(dataset: Dataset, principal: Principal | null): LatestPoint | null {
  const years = getYears(dataset);
  const series = seriesForPrincipal(dataset, principal);
  for (let y = years.length - 1; y >= 0; y--) {
    const arr = series[years[y]];
    if (!arr) continue;
    for (let i = 11; i >= 0; i--) {
      if (arr[i] !== null && arr[i] !== undefined) {
        const yoy = !principal
          ? dataset.trendedRevenue.yoy[i]
          : computeYoyAt(series, years, years[y], i);
        return { year: years[y], monthIndex: i, month: dataset.trendedRevenue.months[i], value: arr[i] as number, yoy };
      }
    }
  }
  return null;
}

export function computeYoyAt(
  series: { [year: string]: (number | null)[] },
  years: string[],
  year: string,
  idx: number
): number | null {
  const yi = years.indexOf(year);
  if (yi <= 0) return null;
  const prevYear = years[yi - 1];
  const cur = series[year]?.[idx] ?? null;
  const prev = series[prevYear]?.[idx] ?? null;
  if (cur === null || prev === null || prev === undefined || prev === 0) return null;
  return round1(((cur - prev) / prev) * 100);
}

export interface WeeklyMetrics {
  weeklyRevenue: number;
  weeklyProjection: number;
  weeklyRR: number;
  weekVariance: number;
  achievedProjectionPct: number;
}

export function weeklyRowsFor(dataset: Dataset, principal: Principal | null): WeeklyProjectionRow[] {
  if (!principal) return dataset.weeklyProjection;
  return dataset.weeklyProjection.filter((r) => r.principal === principal.name);
}

export function aggregateWeekly(rows: WeeklyProjectionRow[]): WeeklyMetrics {
  const weeklyRevenue = rows.reduce((s, r) => s + r.weeklyRevenue, 0);
  const weeklyProjection = rows.reduce((s, r) => s + r.weeklyProjection, 0);
  const weeklyRR = rows.reduce((s, r) => s + r.weeklyRR, 0);
  const weekVariance = rows.reduce((s, r) => s + r.weekVariance, 0);
  const achievedProjectionPct = weeklyProjection > 0 ? round1((weeklyRevenue / weeklyProjection) * 100) : 0;
  return { weeklyRevenue, weeklyProjection, weeklyRR, weekVariance, achievedProjectionPct };
}

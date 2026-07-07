import type { Dataset, WeeklyProjectionRow } from "./types";
import { normalizePrincipalKey } from "./normalize";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface WeeklyMetrics {
  weeklyRevenue: number;
  weeklyProjection: number;
  weeklyRR: number;
  weekVariance: number;
  achievedProjectionPct: number;
}

export function weeklyRowsFor(dataset: Dataset, principalKey: string | null): WeeklyProjectionRow[] {
  if (!principalKey) return dataset.weeklyProjection;
  return dataset.weeklyProjection.filter((r) => normalizePrincipalKey(r.principal) === principalKey);
}

export function aggregateWeekly(rows: WeeklyProjectionRow[]): WeeklyMetrics {
  const weeklyRevenue = rows.reduce((s, r) => s + r.weeklyRevenue, 0);
  const weeklyProjection = rows.reduce((s, r) => s + r.weeklyProjection, 0);
  const weeklyRR = rows.reduce((s, r) => s + r.weeklyRR, 0);
  const weekVariance = rows.reduce((s, r) => s + r.weekVariance, 0);
  const achievedProjectionPct = weeklyProjection > 0 ? round1((weeklyRevenue / weeklyProjection) * 100) : 0;
  return { weeklyRevenue, weeklyProjection, weeklyRR, weekVariance, achievedProjectionPct };
}

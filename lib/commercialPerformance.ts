// Server-only helper for Commercial Performance's Weekly & Monthly Target
// panel — a company-wide (session-scoped) rollup of how many principals'
// Weekly Target entries reconcile to their admin-entered Monthly Target,
// reusing /weekly-targets and /targets-overview's own selectors
// (classifyMonthlyVariance, getWeeksInMonth) rather than re-deriving the
// match/over/under/in-progress rule a second time.
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { getWeeksInMonth, classifyMonthlyVariance, type MonthlyVarianceStatus } from "@/lib/weeklyTargets";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";

export interface PrincipalTargetReconciliation {
  principal: string;
  weeklySum: number;
  monthlyValue: number | null;
  status: MonthlyVarianceStatus;
}

export interface WeeklyMonthlyTargetSummary {
  year: string;
  month: string;
  totalMonthlyTarget: number;
  totalWeeklySum: number;
  achievementPct: number | null;
  byStatus: Record<MonthlyVarianceStatus, number>;
  principals: PrincipalTargetReconciliation[];
}

export async function getWeeklyMonthlyTargetSummary(
  year: string,
  month: string,
  scope: TeamLeaderScope | null
): Promise<WeeklyMonthlyTargetSummary> {
  const monthIndex = CANONICAL_MONTHS.indexOf(month);
  const weeks = monthIndex >= 0 ? getWeeksInMonth(Number(year), monthIndex) : [];
  const principalWhere = scope ? { principal: { in: scope.principals } } : {};

  const [targetRows, weeklyRows] = await Promise.all([
    prisma.target.findMany({ where: { year, month, ...principalWhere }, select: { principal: true, valueTarget: true } }),
    weeks.length > 0
      ? prisma.weeklyTarget.findMany({
          where: { weekStartDate: { in: weeks.map((w) => w.weekStartDate) }, ...principalWhere },
          select: { principal: true, weekLabel: true, targetValue: true },
        })
      : Promise.resolve([]),
  ]);

  const monthlyValueByPrincipal = new Map(targetRows.map((t) => [t.principal, t.valueTarget]));
  const weeklySumByKey = new Map<string, number>();
  for (const r of weeklyRows) {
    const key = `${r.principal}|${r.weekLabel}`;
    weeklySumByKey.set(key, (weeklySumByKey.get(key) ?? 0) + r.targetValue);
  }

  // Every principal either side has ever mentioned this month — a principal
  // with a Monthly Target but no Weekly Target rows yet still counts (as
  // "under", once weeks.length has elapsed) rather than being silently
  // dropped, and vice versa.
  const allPrincipals = Array.from(new Set([...targetRows.map((t) => t.principal), ...weeklyRows.map((r) => r.principal)])).sort();

  const principals: PrincipalTargetReconciliation[] = allPrincipals.map((principal) => {
    let sum = 0;
    let filled = 0;
    for (const w of weeks) {
      const value = weeklySumByKey.get(`${principal}|${w.weekLabel}`) ?? 0;
      sum += value;
      if (value > 0) filled += 1;
    }
    const monthlyValue = monthlyValueByPrincipal.get(principal) ?? null;
    return { principal, weeklySum: sum, monthlyValue, status: classifyMonthlyVariance(monthlyValue, sum, filled, weeks.length) };
  });

  const totalMonthlyTarget = targetRows.reduce((sum, t) => sum + (t.valueTarget ?? 0), 0);
  const totalWeeklySum = principals.reduce((sum, p) => sum + p.weeklySum, 0);
  const byStatus: Record<MonthlyVarianceStatus, number> = { "no-target": 0, match: 0, over: 0, under: 0, "in-progress": 0 };
  for (const p of principals) byStatus[p.status] += 1;

  return {
    year,
    month,
    totalMonthlyTarget,
    totalWeeklySum,
    achievementPct: totalMonthlyTarget > 0 ? Math.round((totalWeeklySum / totalMonthlyTarget) * 1000) / 10 : null,
    byStatus,
    principals,
  };
}

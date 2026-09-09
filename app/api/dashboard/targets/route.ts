import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { buildTargetPacingPlan } from "@/lib/targetPacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only feed for Executive weekly/daily pacing. Official Monthly Target is
 * the governing source; the current month's open weeks and days are rebalanced
 * from posted actuals without mutating the editable planning tables. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const monthLabel = searchParams.get("monthLabel");
  const principals = searchParams.getAll("principal").map((principal) => principal.trim()).filter(Boolean);
  if (!year || !monthLabel) {
    return NextResponse.json({ error: "\"year\" and \"monthLabel\" are required." }, { status: 400 });
  }

  const monthIndex = CANONICAL_MONTHS.indexOf(monthLabel);
  if (monthIndex < 0) {
    return NextResponse.json({ error: `Unrecognized month "${monthLabel}".` }, { status: 400 });
  }
  const monthStart = new Date(Date.UTC(Number(year), monthIndex, 1));
  const monthEnd = new Date(Date.UTC(Number(year), monthIndex + 1, 1));

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && principals.some((principal) => !scope.principals.includes(principal))) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }
  const principalWhere = principals.length > 0 ? { principal: { in: principals } } : scope ? { principal: { in: scope.principals } } : {};

  // scope.teamLeaderIds is [] for a principal-restricted VIEWER (no team-leader
  // identity of their own) — only narrow by it when non-empty, otherwise
  // principalWhere alone is the whole restriction, giving them every Team
  // Leader's Weekly/Daily targets for their allowed principals. Plural (not the
  // singular teamLeaderId) so a SUPERVISOR session narrows to every Team Leader in
  // their own group — a TEAM_LEADER session's teamLeaderIds is always just [their own id].
  const teamLeaderWhere = scope && scope.teamLeaderIds.length > 0 ? { teamLeaderId: { in: scope.teamLeaderIds } } : {};

  const [monthlyTargets, actuals, manualWeeklyTargets, manualDailyTargets] = await Promise.all([
    prisma.target.findMany({
      where: { year, month: monthLabel, ...principalWhere, valueTarget: { not: null } },
      select: { principal: true, valueTarget: true },
    }),
    prisma.dailyBrandCustomerActual.groupBy({
      by: ["date", "principal"],
      where: { date: { gte: monthStart, lt: monthEnd }, ...principalWhere },
      _sum: { revenue: true },
    }),
    prisma.weeklyTarget.findMany({
      where: { year, monthLabel, ...principalWhere, ...teamLeaderWhere },
      select: { weekLabel: true, weekStartDate: true, principal: true, targetValue: true },
    }),
    prisma.dailyTarget.findMany({
      where: {
        ...principalWhere,
        ...teamLeaderWhere,
        date: { gte: monthStart, lt: monthEnd },
      },
      select: { date: true, principal: true, targetValue: true },
    }),
  ]);

  const plannedPrincipals = new Set(monthlyTargets.map((target) => target.principal));
  const actualsByPrincipal = new Map<string, { date: string; revenue: number }[]>();
  for (const actual of actuals) {
    const rows = actualsByPrincipal.get(actual.principal) ?? [];
    rows.push({ date: actual.date.toISOString().slice(0, 10), revenue: actual._sum.revenue ?? 0 });
    actualsByPrincipal.set(actual.principal, rows);
  }

  const plans = monthlyTargets.map((target) => ({
    principal: target.principal,
    ...buildTargetPacingPlan({
      year: Number(year),
      monthIndex,
      monthlyTarget: target.valueTarget ?? 0,
      actuals: actualsByPrincipal.get(target.principal) ?? [],
    }),
  }));
  const asOfDate = plans[0]?.asOfDate;
  const isRebalanced = plans.some((plan) => plan.isRebalanced);

  const weeklyTargets = [
    ...plans.flatMap((plan) => plan.weeklyTargets.map((target) => ({ ...target, principal: plan.principal }))),
    ...manualWeeklyTargets.filter((target) => !plannedPrincipals.has(target.principal)),
  ];
  const dailyTargets = [
    ...plans.flatMap((plan) => plan.dailyTargets.map((target) => ({ ...target, principal: plan.principal }))),
    ...manualDailyTargets.filter((target) => !plannedPrincipals.has(target.principal)),
  ];

  const firstMetrics = plans[0]?.metrics;
  const pacing = firstMetrics
    ? {
        fullMonthTarget: plans.reduce((sum, plan) => sum + plan.metrics.fullMonthTarget, 0),
        fullMonthBalance: plans.reduce((sum, plan) => sum + plan.metrics.fullMonthBalance, 0),
        mtdActual: plans.reduce((sum, plan) => sum + plan.metrics.mtdActual, 0),
        // The calendar is shared across every selected principal, so aggregate
        // revenue first and divide once; never sum per-principal rates.
        rateOfSale: firstMetrics.elapsedWorkingDays > 0 ? plans.reduce((sum, plan) => sum + plan.metrics.mtdActual, 0) / firstMetrics.elapsedWorkingDays : null,
        projection: firstMetrics.elapsedWorkingDays > 0 ? (plans.reduce((sum, plan) => sum + plan.metrics.mtdActual, 0) / firstMetrics.elapsedWorkingDays) * firstMetrics.totalWorkingDays : null,
        dailyRunRate: firstMetrics.remainingWorkingDays > 0 ? plans.reduce((sum, plan) => sum + (plan.metrics.dailyRunRate ?? 0), 0) : null,
        totalWorkingDays: firstMetrics.totalWorkingDays,
        elapsedWorkingDays: firstMetrics.elapsedWorkingDays,
        remainingWorkingDays: firstMetrics.remainingWorkingDays,
      }
    : null;

  return NextResponse.json({ weeklyTargets, dailyTargets, pacing, asOfDate, isRebalanced });
}

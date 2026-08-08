import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only feed for the Executive Overview's Week 1-4/This Week/Daily Projection
 *  cards — WeeklyTarget (week-grain projection) and DailyTarget (day-grain, rep-level
 *  projection) for a given month, optionally scoped to one Principal. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const monthLabel = searchParams.get("monthLabel");
  const principal = searchParams.get("principal");
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
  if (scope && principal && !scope.principals.includes(principal)) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }
  const principalWhere = principal ? { principal } : scope ? { principal: { in: scope.principals } } : {};

  // scope.teamLeaderIds is [] for a principal-restricted VIEWER (no team-leader
  // identity of their own) — only narrow by it when non-empty, otherwise
  // principalWhere alone is the whole restriction, giving them every Team
  // Leader's Weekly/Daily targets for their allowed principals. Plural (not the
  // singular teamLeaderId) so a SUPERVISOR session narrows to every Team Leader in
  // their own group — a TEAM_LEADER session's teamLeaderIds is always just [their own id].
  const teamLeaderWhere = scope && scope.teamLeaderIds.length > 0 ? { teamLeaderId: { in: scope.teamLeaderIds } } : {};

  const [weeklyTargets, dailyTargets] = await Promise.all([
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

  return NextResponse.json({ weeklyTargets, dailyTargets });
}

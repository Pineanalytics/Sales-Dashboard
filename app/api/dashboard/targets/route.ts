import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

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

  const [weeklyTargets, dailyTargets] = await Promise.all([
    prisma.weeklyTarget.findMany({
      where: { year, monthLabel, ...(principal ? { principal } : {}) },
      select: { weekLabel: true, weekStartDate: true, principal: true, targetValue: true },
    }),
    prisma.dailyTarget.findMany({
      where: {
        ...(principal ? { principal } : {}),
        date: { gte: monthStart, lt: monthEnd },
      },
      select: { date: true, principal: true, targetValue: true },
    }),
  ]);

  return NextResponse.json({ weeklyTargets, dailyTargets });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function dayAfter(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date-matched revenue comparison from the SAP daily aggregate feed.
 *
 * The latest actual day in the requested month controls every comparison:
 * e.g. 1-14 Aug 2026 is compared with 1-14 Jul 2026 and 1-14 Aug 2025.
 * This avoids calling a partial live month "down" against a completed month.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const principal = searchParams.get("principal");
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: '"year" and "month" are required.' }, { status: 400 });
  }

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && principal && !scope.principals.includes(principal)) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }
  const principalWhere = principal ? { principal } : scope ? { principal: { in: scope.principals } } : {};
  const monthStart = utcDate(year, month, 1);
  const nextMonthStart = utcDate(year, month === 12 ? 1 : month + 1, 1);
  const latest = await prisma.dailySalesActual.findFirst({
    where: { ...principalWhere, date: { gte: monthStart, lt: nextMonthStart } },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  if (!latest) {
    return NextResponse.json({ available: false, reason: "No daily SAP actuals are available for this month yet." });
  }

  const cutoff = latest.date.getUTCDate();
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousCutoff = Math.min(cutoff, daysInMonth(previousYear, previousMonth));
  const priorYearCutoff = Math.min(cutoff, daysInMonth(year - 1, month));
  const windows = {
    current: { from: monthStart, through: latest.date },
    mom: { from: utcDate(previousYear, previousMonth, 1), through: utcDate(previousYear, previousMonth, previousCutoff) },
    yoy: { from: utcDate(year - 1, month, 1), through: utcDate(year - 1, month, priorYearCutoff) },
  };

  const totals = await Promise.all(
    Object.values(windows).map((window) =>
      prisma.dailySalesActual.aggregate({
        where: { ...principalWhere, date: { gte: window.from, lt: dayAfter(window.through) } },
        _sum: { revenue: true },
        _count: { id: true },
      })
    )
  );
  const result = (["current", "mom", "yoy"] as const).reduce((acc, key, index) => {
    const total = totals[index];
    const window = windows[key];
    acc[key] = {
      from: dateKey(window.from),
      through: dateKey(window.through),
      revenue: total._count.id > 0 ? total._sum.revenue ?? 0 : null,
      rows: total._count.id,
    };
    return acc;
  }, {} as Record<"current" | "mom" | "yoy", { from: string; through: string; revenue: number | null; rows: number }>);

  return NextResponse.json({ available: true, asOf: dateKey(latest.date), ...result });
}

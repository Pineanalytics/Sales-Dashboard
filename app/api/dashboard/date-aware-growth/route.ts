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

/** Date-matched month-over-month revenue comparison from the SAP daily feed.
 *
 * The latest actual day in the requested month controls the previous-month
 * comparison: e.g. 1-14 Aug 2026 is compared with 1-14 Jul 2026. YoY is not
 * served here: Sales Cockpit compares the selected month with the full same
 * calendar month in the prior year's authoritative monthly SAP history.
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
  const latestCustomerActual = await prisma.dailyBrandCustomerActual.findFirst({
    where: { ...principalWhere, date: { gte: monthStart, lt: nextMonthStart } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const latest = latestCustomerActual ?? await prisma.dailySalesActual.findFirst({
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
  const windows = {
    current: { from: monthStart, through: latest.date },
    mom: { from: utcDate(previousYear, previousMonth, 1), through: utcDate(previousYear, previousMonth, previousCutoff) },
  };

  const totals = await Promise.all(
    Object.values(windows).map(async (window) => {
      const canonical = await prisma.dailyBrandCustomerActual.aggregate({
        where: { ...principalWhere, date: { gte: window.from, lt: dayAfter(window.through) } },
        _sum: { revenue: true },
        _count: { id: true },
      });
      // Customer & Brands is canonical whenever it exists. Historical daily
      // snapshots predate that feed, so retain DailySalesActual only as a
      // date-matched comparison fallback (not as a live-month source).
      return canonical._count.id > 0
        ? canonical
        : prisma.dailySalesActual.aggregate({
            where: { ...principalWhere, date: { gte: window.from, lt: dayAfter(window.through) } },
            _sum: { revenue: true },
            _count: { id: true },
          });
    })
  );
  const result = (["current", "mom"] as const).reduce((acc, key, index) => {
    const total = totals[index];
    const window = windows[key];
    acc[key] = {
      from: dateKey(window.from),
      through: dateKey(window.through),
      revenue: total._count.id > 0 ? total._sum.revenue ?? 0 : null,
      rows: total._count.id,
    };
    return acc;
  }, {} as Record<"current" | "mom", { from: string; through: string; revenue: number | null; rows: number }>);

  return NextResponse.json({ available: true, asOf: dateKey(latest.date), ...result });
}

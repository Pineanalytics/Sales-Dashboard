import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { daysInRange, isIsoDate, MAX_RANGE_DAYS, previousPeriod, sameDatesLastYear } from "@/lib/salesRange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOP_LIMIT = 150;

function startOf(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** The range [from, to] inclusive, as a half-open Prisma date filter. */
function dateFilter(from: string, to: string) {
  const end = startOf(to);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: startOf(from), lt: end };
}

/** SAP daily actuals for any date range — Sales Performance's "Date range"
 *  view. Returns principal-by-day actuals for the range, for the previous
 *  period of the same length and for the same dates last year, plus the
 *  range's reps, customers and brands. Targets are not served here: the
 *  client pro-rates the monthly targets it already holds (lib/salesRange.ts).
 *  Scoped like the other sales routes: a scoped login sees only its own
 *  principals, and only its own reps. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: '"from" and "to" must be dates (YYYY-MM-DD), "from" on or before "to".' }, { status: 400 });
  }
  if (daysInRange(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `A date range can span at most ${MAX_RANGE_DAYS} days.` }, { status: 400 });
  }
  const requested = (params.get("principals") ?? "").split(",").map((value) => value.trim()).filter(Boolean);

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    if (scope && requested.some((principal) => !scope.principals.includes(principal))) {
      return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
    }
    const principals = requested.length > 0 ? requested : scope ? scope.principals : null;
    const principalWhere = principals ? { principal: { in: principals } } : {};
    const repWhere = scope ? { ...principalWhere, employeeCode: { in: scope.employeeCodes } } : principalWhere;
    const previous = previousPeriod(from, to);
    const lastYear = sameDatesLastYear(from, to);

    const [current, prior, yearAgo, latest, reps, priorReps, customers, brands, earliestCustomerDay] = await Promise.all([
      prisma.dailySalesActual.groupBy({ by: ["date", "principal"], where: { ...principalWhere, date: dateFilter(from, to) }, _sum: { revenue: true, cogs: true, grossProfit: true } }),
      prisma.dailySalesActual.groupBy({ by: ["date", "principal"], where: { ...principalWhere, date: dateFilter(previous.from, previous.to) }, _sum: { revenue: true, grossProfit: true } }),
      prisma.dailySalesActual.groupBy({ by: ["date", "principal"], where: { ...principalWhere, date: dateFilter(lastYear.from, lastYear.to) }, _sum: { revenue: true, grossProfit: true } }),
      prisma.dailySalesActual.findFirst({ where: principalWhere, orderBy: { date: "desc" }, select: { date: true } }),
      prisma.dailySalesRepActual.groupBy({
        by: ["sapName", "employeeCode", "employeeName", "principal"],
        where: { ...repWhere, date: dateFilter(from, to) },
        _sum: { revenue: true, grossProfit: true, cases: true },
      }),
      prisma.dailySalesRepActual.groupBy({ by: ["sapName", "employeeCode"], where: { ...repWhere, date: dateFilter(previous.from, previous.to) }, _sum: { revenue: true } }),
      prisma.dailyBrandCustomerActual.groupBy({
        by: ["customerName", "sapName"],
        where: { ...principalWhere, date: dateFilter(from, to) },
        _sum: { revenue: true, grossProfit: true, cases: true },
        orderBy: { _sum: { revenue: "desc" } },
        take: TOP_LIMIT,
      }),
      prisma.dailyBrandCustomerActual.groupBy({
        by: ["principal", "brand"],
        where: { ...principalWhere, date: dateFilter(from, to) },
        _sum: { revenue: true, grossProfit: true, cases: true },
        orderBy: { _sum: { revenue: "desc" } },
        take: TOP_LIMIT,
      }),
      prisma.dailyBrandCustomerActual.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    ]);

    const day = (date: Date) => date.toISOString().slice(0, 10);
    const daily = (rows: { date: Date; principal: string; _sum: { revenue: number | null; cogs?: number | null; grossProfit: number | null } }[]) =>
      rows.map((row) => ({
        date: day(row.date),
        principal: row.principal,
        revenue: row._sum.revenue ?? 0,
        cogs: row._sum.cogs ?? 0,
        grossProfit: row._sum.grossProfit ?? 0,
      }));

    // One row per rep across the principals they sold in the range.
    const priorByRep = new Map(priorReps.map((row) => [`${row.employeeCode ?? ""}|${row.sapName}`, row._sum.revenue ?? 0]));
    const repRows = new Map<string, { key: string; employeeCode: string | null; name: string; sapName: string; principals: Set<string>; revenue: number; grossProfit: number; cases: number }>();
    for (const row of reps) {
      const key = `${row.employeeCode ?? ""}|${row.sapName}`;
      const entry = repRows.get(key) ?? { key, employeeCode: row.employeeCode, name: row.employeeName || row.sapName, sapName: row.sapName, principals: new Set<string>(), revenue: 0, grossProfit: 0, cases: 0 };
      entry.principals.add(row.principal);
      entry.revenue += row._sum.revenue ?? 0;
      entry.grossProfit += row._sum.grossProfit ?? 0;
      entry.cases += row._sum.cases ?? 0;
      repRows.set(key, entry);
    }

    return NextResponse.json({
      from,
      to,
      previous: { ...previous, daily: daily(prior) },
      lastYear: { ...lastYear, daily: daily(yearAgo) },
      daily: daily(current),
      latestDate: latest ? day(latest.date) : null,
      reps: Array.from(repRows.values())
        .map(({ principals: repPrincipals, key, ...rest }) => ({ ...rest, principals: Array.from(repPrincipals).sort(), previousRevenue: priorByRep.get(key) ?? 0 }))
        .sort((a, b) => b.revenue - a.revenue),
      customers: customers.map((row) => ({ customerName: row.customerName, sapName: row.sapName, revenue: row._sum.revenue ?? 0, grossProfit: row._sum.grossProfit ?? 0, cases: row._sum.cases ?? 0 })),
      brands: brands.map((row) => ({ principal: row.principal, brand: row.brand, revenue: row._sum.revenue ?? 0, grossProfit: row._sum.grossProfit ?? 0, cases: row._sum.cases ?? 0 })),
      customerDataFrom: earliestCustomerDay ? day(earliestCustomerDay.date) : null,
    });
  } catch (err) {
    console.error("Failed to load date-range sales", err);
    return NextResponse.json({ error: "Failed to load sales for this date range." }, { status: 500 });
  }
}

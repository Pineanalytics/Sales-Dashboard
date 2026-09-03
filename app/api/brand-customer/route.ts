import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLiveBrandCustomerRows, getLiveDailyBrandCustomerRows } from "@/lib/datasetStore";
import { normalizePrincipalKey } from "@/lib/normalize";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { summarizeRankingDrill } from "@/lib/rankingDrill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function periodsFromRequest(request: NextRequest) {
  const periods = request.nextUrl.searchParams.getAll("period");
  return periods.flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: match[1], monthIndex: Number(match[2]) - 1 }] : [];
  });
}

/** On-demand customer/brand detail. This deliberately remains separate from
 * /api/dataset so opening an ordinary dashboard page never transfers the
 * high-cardinality transaction rows to the browser. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const periods = periodsFromRequest(request);
  if (periods.length === 0) {
    return NextResponse.json({ error: "Provide at least one period in YYYY-MM format." }, { status: 400 });
  }

  const requestedPrincipalNames = request.nextUrl.searchParams.getAll("principal");
  const requestedPrincipals = new Set(requestedPrincipalNames.map(normalizePrincipalKey));
  const scope = await resolveScopeForSession(
    session.user.role,
    session.user.teamLeaderId,
    session.user.allowedPrincipals,
    session.user.supervisorId
  );
  const allowedPrincipals = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
  const inScope = (row: { principalKey: string }) =>
    (!allowedPrincipals || allowedPrincipals.has(row.principalKey)) &&
    (requestedPrincipals.size === 0 || requestedPrincipals.has(row.principalKey));

  try {
    if (request.nextUrl.searchParams.get("summary") === "daily") {
      // Real day-level revenue for whichever month(s) were requested, straight
      // from DailyBrandCustomerActual — not getLiveBrandCustomerRows' general
      // row shape, which fabricates "day 1 of the month" as a placeholder date
      // for a past month's BrandCustomerActual rows (fine for that function's
      // own monthly-rollup callers, but it collapsed an entire past month's
      // revenue onto a single date here, which is exactly what WeekDailyActuals'
      // Week/Daily cards need real day granularity for).
      const sortedPeriods = [...periods].sort((a, b) => a.year.localeCompare(b.year) || a.monthIndex - b.monthIndex);
      const first = sortedPeriods[0];
      const last = sortedPeriods[sortedPeriods.length - 1];
      const start = new Date(Date.UTC(Number(first.year), first.monthIndex, 1));
      const end = new Date(Date.UTC(Number(last.year), last.monthIndex + 1, 0));
      const dailyRows = (await getLiveDailyBrandCustomerRows(start, end, requestedPrincipalNames)).filter(inScope);

      const revenueByDate = new Map<string, number>();
      for (const row of dailyRows) revenueByDate.set(row.date, (revenueByDate.get(row.date) ?? 0) + row.revenue);
      return NextResponse.json(
        { daily: [...revenueByDate].map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date)) },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const rows = (await getLiveBrandCustomerRows(periods, requestedPrincipalNames)).filter(inScope);

    if (request.nextUrl.searchParams.get("summary") === "drill") {
      return NextResponse.json(
        { drill: summarizeRankingDrill(rows) },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load customer and brand detail", error);
    return NextResponse.json({ error: "Failed to load customer and brand detail." }, { status: 500 });
  }
}

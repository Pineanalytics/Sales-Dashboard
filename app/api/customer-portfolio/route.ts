import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLiveBrandCustomerRows } from "@/lib/datasetStore";
import { normalizePrincipalKey } from "@/lib/normalize";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { summarizeCustomerPortfolio } from "@/lib/customerPortfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthRef { year: string; monthIndex: number }

function periods(request: NextRequest, name: string): MonthRef[] {
  return request.nextUrl.searchParams.getAll(name).flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: match[1], monthIndex: Number(match[2]) - 1 }] : [];
  });
}

function keySet(values: MonthRef[]) {
  return new Set(values.map((value) => `${value.year}|${value.monthIndex}`));
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const currentPeriods = periods(request, "period");
  const latestPeriods = periods(request, "latestPeriod");
  const previousPeriods = periods(request, "previousPeriod");
  const priorYearPeriods = periods(request, "priorYearPeriod");
  if (currentPeriods.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });

  const requestedPrincipalNames = request.nextUrl.searchParams.getAll("principal");
  const requestedPrincipalKeys = new Set(requestedPrincipalNames.map(normalizePrincipalKey));
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const allowedKeys = scope ? new Set(scope.principals.map(normalizePrincipalKey)) : null;
  const allPeriods = [...currentPeriods, ...latestPeriods, ...previousPeriods, ...priorYearPeriods];
  const currentKeys = keySet(currentPeriods);
  const latestKeys = keySet(latestPeriods);
  const previousKeys = keySet(previousPeriods);
  const priorYearKeys = keySet(priorYearPeriods);

  try {
    const rows = (await getLiveBrandCustomerRows(allPeriods, requestedPrincipalNames)).filter((row) =>
      (!allowedKeys || allowedKeys.has(row.principalKey)) &&
      (requestedPrincipalKeys.size === 0 || requestedPrincipalKeys.has(row.principalKey))
    );
    const belongs = (row: { year: string; monthIndex: number }, keys: Set<string>) => keys.has(`${row.year}|${row.monthIndex}`);
    return NextResponse.json({
      portfolio: summarizeCustomerPortfolio({
        currentRows: rows.filter((row) => belongs(row, currentKeys)),
        latestMonthRows: rows.filter((row) => belongs(row, latestKeys)),
        previousMonthRows: rows.filter((row) => belongs(row, previousKeys)),
        priorYearRows: rows.filter((row) => belongs(row, priorYearKeys)),
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load customer portfolio", error);
    return NextResponse.json({ error: "Failed to load customer portfolio." }, { status: 500 });
  }
}

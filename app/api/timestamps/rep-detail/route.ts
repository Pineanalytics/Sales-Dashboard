import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTimestampRepDetail, type TimestampChartGranularity, type TimestampFilters, type TimestampRoleFilter } from "@/lib/timestampSummary";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(raw: string | null): Date | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const employeeCode = req.nextUrl.searchParams.get("rep")?.trim();
  if (!employeeCode) return NextResponse.json({ error: '"rep" is required.' }, { status: 400 });

  const role = req.nextUrl.searchParams.get("role");
  const roleFilter: TimestampRoleFilter = role === "Primary Sales" || role === "Secondary Sales" ? role : "all";
  const granularity = req.nextUrl.searchParams.get("granularity");
  const chartGranularity: TimestampChartGranularity = granularity === "Daily" || granularity === "Weekly" ? granularity : "Hourly";
  const rawMonth = req.nextUrl.searchParams.get("month");
  const month = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : null;
  const filters: TimestampFilters = {
    principalKey: req.nextUrl.searchParams.get("principal")?.trim() || null,
    month,
    date: parseDate(req.nextUrl.searchParams.get("date")),
    employeeCode,
    region: req.nextUrl.searchParams.get("region")?.trim() || null,
    teamLeader: req.nextUrl.searchParams.get("teamLeader")?.trim() || null,
    roleFilter,
    chartGranularity,
  };

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    return NextResponse.json(await getTimestampRepDetail(new Date(), scope, filters));
  } catch (error) {
    console.error("Failed to load Timestamps rep detail", error);
    return NextResponse.json({ error: "Failed to load rep detail." }, { status: 500 });
  }
}

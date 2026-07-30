import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTimestampSummary,
  type TimestampChartGranularity,
  type TimestampFilters,
  type TimestampRoleFilter,
} from "@/lib/timestampSummary";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(raw: string | null): Date | null | NextResponse {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: '"date" must be a YYYY-MM-DD value.' }, { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: '"date" must be valid.' }, { status: 400 });
  }
  return parsed;
}

function parseRole(raw: string | null): TimestampRoleFilter | NextResponse {
  if (!raw || raw === "all") return "all";
  if (raw === "Primary Sales" || raw === "Secondary Sales") return raw;
  return NextResponse.json({ error: '"role" must be all, Primary Sales, or Secondary Sales.' }, { status: 400 });
}

function parseGranularity(raw: string | null): TimestampChartGranularity | NextResponse {
  if (!raw || raw === "Hourly") return "Hourly";
  if (raw === "Daily" || raw === "Weekly") return raw;
  return NextResponse.json({ error: '"granularity" must be Hourly, Daily, or Weekly.' }, { status: 400 });
}

/** Compact server-side aggregate for the Timestamps dashboard. The full call
 * detail remains available through /api/timestamps for report exports, while
 * the interactive page receives only the KPI, chart, filter, and rep-day data
 * it actually renders. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const date = parseDate(req.nextUrl.searchParams.get("date"));
  if (date instanceof NextResponse) return date;
  const roleFilter = parseRole(req.nextUrl.searchParams.get("role"));
  if (roleFilter instanceof NextResponse) return roleFilter;
  const chartGranularity = parseGranularity(req.nextUrl.searchParams.get("granularity"));
  if (chartGranularity instanceof NextResponse) return chartGranularity;

  const principalKey = req.nextUrl.searchParams.get("principal")?.trim() || null;
  const employeeCode = req.nextUrl.searchParams.get("rep")?.trim() || null;
  const filters: TimestampFilters = { principalKey, date, employeeCode, roleFilter, chartGranularity };

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId);
    const [summary, watermark] = await Promise.all([
      getTimestampSummary(new Date(), scope, filters),
      prisma.syncWatermark.findUnique({ where: { bridge: "timestamps" }, select: { updatedAt: true } }),
    ]);
    return NextResponse.json({ ...summary, syncUpdatedAt: watermark?.updatedAt.toISOString() ?? null });
  } catch (err) {
    console.error("Failed to load compact Timestamps summary", err);
    return NextResponse.json({ error: "Failed to load Timestamps summary." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import {
  getJpAdherenceSummaryCached,
  getAvailablePlanMonths,
  getMonthlyCoverageRollup,
  getPatternAdherenceSummary,
  monthWindow,
  type JpAdherenceFilters,
  type SalesRoleFilter,
} from "@/lib/jpAdherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentMonthLabel(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseMonth(raw: string | null): { year: string; monthIndex: number } | null {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [year, mon] = raw.split("-");
  return { year, monthIndex: Number(mon) - 1 };
}

function parseDate(raw: string | null): Date | null | NextResponse {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: '"date" must be a YYYY-MM-DD value.' }, { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: '"date" must be valid.' }, { status: 400 });
  return parsed;
}

function parseRole(raw: string | null): SalesRoleFilter | NextResponse {
  if (!raw || raw === "all") return "all";
  if (raw === "Primary Sales" || raw === "Secondary Sales") return raw;
  return NextResponse.json({ error: '"role" must be all, Primary Sales, or Secondary Sales.' }, { status: 400 });
}

const VALID_DAY_NAMES = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

function parseDayNames(raw: string | null): string[] | null | NextResponse {
  if (!raw) return null;
  const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (!names.every((n) => VALID_DAY_NAMES.has(n))) {
    return NextResponse.json({ error: '"dayNames" must be a comma-separated list of day names.' }, { status: 400 });
  }
  return names;
}

/** Compact, live-computed JP Adherence dashboard feed — mirrors the Timestamps
 *  summary route's pattern (server-side aggregate, not raw rows). Defaults to
 *  the current calendar month so an unfiltered page load stays bounded, rather
 *  than the old page's "load everything" behavior. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const now = new Date();
  const fromParam = parseDate(req.nextUrl.searchParams.get("from"));
  if (fromParam instanceof NextResponse) return fromParam;
  const toParam = parseDate(req.nextUrl.searchParams.get("to"));
  if (toParam instanceof NextResponse) return toParam;
  const monthParam = parseMonth(req.nextUrl.searchParams.get("month")) ?? parseMonth(currentMonthLabel(now))!;
  const date = parseDate(req.nextUrl.searchParams.get("date"));
  if (date instanceof NextResponse) return date;
  const roleFilter = parseRole(req.nextUrl.searchParams.get("role"));
  if (roleFilter instanceof NextResponse) return roleFilter;
  const dayNames = parseDayNames(req.nextUrl.searchParams.get("dayNames"));
  if (dayNames instanceof NextResponse) return dayNames;

  const principalKey = req.nextUrl.searchParams.get("principal")?.trim() || null;
  const employeeCode = req.nextUrl.searchParams.get("rep")?.trim() || null;
  const teamLeader = req.nextUrl.searchParams.get("teamLeader")?.trim() || null;
  const filters: JpAdherenceFilters = { principalKey, date, dayNames, roleFilter, employeeCode, teamLeader };

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const range = fromParam && toParam ? { start: fromParam, end: toParam } : monthWindow(monthParam.year, monthParam.monthIndex);
    const [summary, availableMonths, monthlyCoverage, patternAdherence] = await Promise.all([
      getJpAdherenceSummaryCached(range, scope, filters),
      getAvailablePlanMonths(scope),
      getMonthlyCoverageRollup(scope),
      getPatternAdherenceSummary(range, scope, filters),
    ]);
    return NextResponse.json({ ...summary, availableMonths, monthlyCoverage, patternAdherence });
  } catch (err) {
    console.error("Failed to load JP Adherence data", err);
    return NextResponse.json({ error: "Failed to load JP Adherence data." }, { status: 500 });
  }
}

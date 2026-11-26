import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeeReport } from "@/lib/pageAccess";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { filterFacts, filterOptions, groupFacts, measure } from "@/lib/callAnalysis/aggregate";
import { loadAvailability, loadRepDayFacts } from "@/lib/callAnalysis/facts";
import {
  CALL_ANALYSIS_MAX_DAYS,
  CALL_GROUP_OPTIONS,
  CALL_SOURCES,
  type CallAnalysisResult,
  type CallGroupBy,
  type CallRoleFilter,
  type CallSource,
} from "@/lib/callAnalysis/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const ROLES: CallRoleFilter[] = ["all", "Primary Sales", "Secondary Sales"];

function parseDay(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const value = new Date(`${raw}T00:00:00.000Z`);
  // 2026-02-31 parses as a March date: take only a day that reads back as written.
  return Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== raw ? null : value;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** Call analysis: timestamps, coverage and productivity (with lines per productive call and drop size) for a run of days. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { role: userRole, allowedPages } = session.user;
  // The report shows both rep times and coverage figures, so it needs both grants.
  if (!canSeeReport(userRole, allowedPages ?? [], "coverage") || !canSeeReport(userRole, allowedPages ?? [], "timestamps")) {
    return NextResponse.json({ error: "You don't have access to the call analysis report." }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));
  if (!from || !to) return bad('"from" and "to" must be YYYY-MM-DD dates.');
  if (to < from) return bad('"to" must not be before "from".');
  if ((to.getTime() - from.getTime()) / DAY_MS + 1 > CALL_ANALYSIS_MAX_DAYS) return bad(`Choose at most ${CALL_ANALYSIS_MAX_DAYS} days.`);

  const groupBy = (params.get("group") ?? "rep") as CallGroupBy;
  if (!CALL_GROUP_OPTIONS.some((option) => option.key === groupBy)) return bad('"group" is not a known grouping.');
  const role = (params.get("role") ?? "all") as CallRoleFilter;
  if (!ROLES.includes(role)) return bad('"role" must be all, Primary Sales, or Secondary Sales.');
  const sourceParam = params.get("source");
  if (sourceParam && !(CALL_SOURCES as readonly string[]).includes(sourceParam)) return bad('"source" is not a known system.');
  const principals = params.getAll("principal").map((p) => p.trim()).filter(Boolean);
  if (principals.length > 50 || principals.some((p) => p.length > 100)) return bad('"principal" is not valid.');
  const repKey = params.get("rep")?.trim() || null;
  const teamLeader = params.get("teamLeader")?.trim() || null;

  try {
    const scope = await resolveScopeForSession(userRole, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const [facts, availability] = await Promise.all([
      loadRepDayFacts({
        start: from,
        end: new Date(to.getTime() + DAY_MS),
        principals,
        sources: sourceParam ? [sourceParam as CallSource] : CALL_SOURCES,
        scope,
      }),
      loadAvailability(),
    ]);
    const selected = filterFacts(facts, { repKey, teamLeader, role });
    const result: CallAnalysisResult = {
      from: params.get("from")!,
      to: params.get("to")!,
      groupBy,
      total: measure(selected),
      rows: groupFacts(selected, groupBy),
      trend: groupFacts(selected, "day"),
      options: filterOptions(facts),
      availability,
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load the call analysis", error);
    return NextResponse.json({ error: "Failed to load the call analysis." }, { status: 500 });
  }
}

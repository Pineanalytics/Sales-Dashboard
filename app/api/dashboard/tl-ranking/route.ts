import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { buildTlRanking, buildSupervisorRanking, buildManagerRanking, type RepRevenueInput, type SupervisorRankingResult, type ManagerRankingResult, type TlRankingRow, type UnmatchedRep } from "@/lib/tlRanking";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getMtdTargetByTeamLeader } from "@/lib/mtdTarget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlRankingRow[]; unmatchedReps: UnmatchedRep[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unmatchedReps: UnmatchedRep[] };

/** The heavy Excel-derived rep-revenue aggregation (summarizeBrandCustomerByRep)
 *  already runs client-side against the Zustand-held Dataset — duplicating that
 *  dataset-loading here would mean two sources of truth for the same numbers. This
 *  route only does the Prisma-only half: joining that revenue to Team Leaders and
 *  their WeeklyTarget sum for the given month, then rolling that up to Sales
 *  Supervisor (primary ranking level) and Manager (further rollup) — see
 *  lib/tlRanking.ts's buildSupervisorRanking/buildManagerRanking. An unscoped
 *  (ADMIN/unrestricted VIEWER) session gets the full nested hierarchy; a
 *  TEAM_LEADER or principal-scoped VIEWER keeps the original flat single-TL-level
 *  shape (no supervisor grouping is meaningful for a single-TL view); a SUPERVISOR
 *  session gets the hierarchy narrowed to just their own Supervisor row. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { repRevenue, principalFilter, year, monthLabel } = body as {
    repRevenue?: RepRevenueInput[];
    principalFilter?: string | null;
    year?: string;
    monthLabel?: string;
  };
  if (!Array.isArray(repRevenue) || !year || !monthLabel) {
    return NextResponse.json({ error: "\"repRevenue\", \"year\", and \"monthLabel\" are required." }, { status: 400 });
  }

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && principalFilter && !scope.principals.includes(principalFilter)) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }

  const [assignments, teamLeaders, supervisors, managers, mtdTargets] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      select: { teamLeaderId: true, employeeName: true, sapName: true, principal: true, active: true, supervisorId: true, managerId: true },
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true } }),
    prisma.manager.findMany({ select: { id: true, name: true } }),
    getMtdTargetByTeamLeader(year, monthLabel),
  ]);

  const result = buildTlRanking(repRevenue, assignments, teamLeaders, mtdTargets);

  // TEAM_LEADER and a principal-scoped VIEWER keep today's flat shape — a single
  // Team Leader (or a flat multi-TL list with no meaningful supervisor grouping
  // narrowed further) doesn't benefit from the extra nesting.
  if (scope && (scope.teamLeaderId || !scope.supervisorId)) {
    if (scope.teamLeaderId) {
      const rankings = result.rankings.filter((r) => r.teamLeaderId === scope.teamLeaderId);
      return NextResponse.json({ mode: "flat", rankings, unmatchedReps: [] } satisfies TlRankingResponse);
    }
    // Principal-restricted VIEWER (no single TL identity of their own): show every
    // Team Leader who has at least one active assignment under an allowed principal.
    // Note: mtdTarget/mtdRevenue for those visible rows still reflects each TL's full
    // cross-principal total, not narrowed to just the allowed principal — the same
    // limitation buildTlRanking has always had (no per-principal target breakdown).
    const allowedTeamLeaderIds = new Set(assignments.filter((a) => a.active && scope.principals.includes(a.principal)).map((a) => a.teamLeaderId));
    const rankings = result.rankings.filter((r) => allowedTeamLeaderIds.has(r.teamLeaderId));
    return NextResponse.json({ mode: "flat", rankings, unmatchedReps: [] } satisfies TlRankingResponse);
  }

  const supervisorRanking = buildSupervisorRanking(result.rankings, assignments, supervisors);
  const managerRanking = buildManagerRanking(supervisorRanking.rankings, assignments, managers);

  if (scope?.supervisorId) {
    const rankings = supervisorRanking.rankings.filter((r) => r.supervisorId === scope.supervisorId);
    const narrowedSupervisorRanking: SupervisorRankingResult = { rankings, unassignedTeamLeaders: [] };
    const narrowedManagerRanking = buildManagerRanking(rankings, assignments, managers);
    return NextResponse.json({ mode: "hierarchy", managerRanking: narrowedManagerRanking, supervisorRanking: narrowedSupervisorRanking, unmatchedReps: [] } satisfies TlRankingResponse);
  }

  // Unscoped (ADMIN or an unrestricted VIEWER): full nested hierarchy.
  return NextResponse.json({ mode: "hierarchy", managerRanking, supervisorRanking, unmatchedReps: result.unmatchedReps } satisfies TlRankingResponse);
}

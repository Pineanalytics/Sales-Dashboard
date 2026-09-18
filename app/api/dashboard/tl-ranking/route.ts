import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import {
  buildTlRanking,
  buildSupervisorRanking,
  buildManagerRanking,
  canonicalTeamLeaderIdMap,
  computeTlCompositeScores,
  sortByCompositeScore,
  rollupRepMetricsByTeamLeader,
  rollupJpAdherenceByTeamLeader,
  type PrincipalRevenueInput,
  type SupervisorRankingResult,
  type ManagerRankingResult,
  type TlCompositeRow,
  type UnattributedPrincipal,
} from "@/lib/tlRanking";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getMtdTargetByTeamLeader } from "@/lib/mtdTarget";
import { getRepPerformanceData, buildRepPerformanceRows } from "@/lib/repPerformance";
import { getJpAdherenceSummary, monthWindow } from "@/lib/jpAdherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TlRankingResponse =
  | { mode: "flat"; rankings: TlCompositeRow[]; unattributedPrincipals: UnattributedPrincipal[] }
  | { mode: "hierarchy"; managerRanking: ManagerRankingResult; supervisorRanking: SupervisorRankingResult; unattributedPrincipals: UnattributedPrincipal[] };

/** Strike Rate + Distribution (RepPerformanceRow, RepCall/BrandCustomerActual-
 *  sourced) and JP Adherence (JpRepDaySummaryRow) for the current calendar
 *  month, rolled up per Team Leader — the three extra composite-score inputs
 *  beyond target attainment. Deliberately passes empty sapRows/targets to
 *  buildRepPerformanceRows: strike rate and LPPC are already fully resolved
 *  from RepCall/BrandCustomerActual alone (see its own field-by-field
 *  derivation), so this avoids pulling in the separate SAP revenue feed
 *  (/api/sales/rep-actuals) this route has no other reason to touch. */
async function loadCompositeInputs(scope: Awaited<ReturnType<typeof resolveScopeForSession>>, year: string, monthLabel: string) {
  const monthIndex = new Date(`${monthLabel} 1, ${year}`).getMonth();
  const [repData, jpAdherence] = await Promise.all([
    getRepPerformanceData(year, scope),
    getJpAdherenceSummary(monthWindow(year, monthIndex), scope, {
      principalKey: null,
      date: null,
      dayNames: null,
      roleFilter: "all",
      employeeCode: null,
      teamLeader: null,
    }),
  ]);
  const repRows = buildRepPerformanceRows({
    employees: repData.employees,
    coverageByRepMonth: repData.coverageByRepMonth,
    targets: [],
    sapRows: [],
    repLines: repData.repLines,
    months: [{ year, monthIndex }],
    principalKey: null,
    teamLeaderFilter: null,
    salesRoleFilter: null,
  });
  return {
    repMetricsByTeamLeader: rollupRepMetricsByTeamLeader(repRows),
    jpAdherenceByTeamLeader: rollupJpAdherenceByTeamLeader(jpAdherence.repDaySummary),
  };
}

/** The Excel/SQL-bridge-derived principal-level MTD revenue (dataset.monthlySales,
 *  via lib/timeIntelligence.ts's summarizeSalesByPrincipal) already runs client-side
 *  against the Zustand-held Dataset — duplicating that dataset-loading here would
 *  mean two sources of truth for the same numbers. This route only does the
 *  Prisma-only half: attributing that revenue to whichever Team Leader heads each
 *  principal (Principal.teamLeaderId — see lib/tlRanking.ts's buildTlRanking for why
 *  this replaced rep-name matching), resolving their prorated MTD targets,
 *  then rolling that up to Sales Supervisor (primary ranking level) and Manager
 *  (further rollup) — see lib/tlRanking.ts's buildSupervisorRanking/
 *  buildManagerRanking, which resolve the reporting hierarchy from
 *  TeamLeader.supervisorId / Supervisor.managerId directly (an HR fact about the
 *  Team Leader/Supervisor themselves, not derived from rep-level
 *  TeamLeaderAssignment rows — that was confirmed unreliable, same class of bug
 *  rep-name revenue matching had). An unscoped (ADMIN/unrestricted VIEWER) session
 *  gets the full nested hierarchy; a TEAM_LEADER or principal-scoped VIEWER keeps
 *  the original flat single-TL-level shape (no supervisor grouping is meaningful
 *  for a single-TL view); a SUPERVISOR session gets the hierarchy narrowed to just
 *  their own Supervisor row. */
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

  const { principalRevenue, principalFilters, year, monthLabel } = body as {
    principalRevenue?: PrincipalRevenueInput[];
    principalFilters?: string[];
    year?: string;
    monthLabel?: string;
  };
  if (!Array.isArray(principalRevenue) || !year || !monthLabel || (principalFilters !== undefined && !Array.isArray(principalFilters))) {
    return NextResponse.json({ error: "\"principalRevenue\", \"year\", and \"monthLabel\" are required." }, { status: 400 });
  }

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  const requestedPrincipals = Array.from(new Set((principalFilters ?? []).filter((principal): principal is string => typeof principal === "string" && principal.trim().length > 0)));
  if (scope && requestedPrincipals.some((principal) => !scope.principals.includes(principal))) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }
  // An explicit dashboard selection wins; otherwise a scoped account still
  // remains constrained to its permitted principals. Unrestricted accounts
  // with no selection intentionally receive the full portfolio.
  const effectivePrincipals = requestedPrincipals.length > 0 ? requestedPrincipals : (scope?.principals ?? []);
  const principalWhere = effectivePrincipals.length > 0 ? { principal: { in: effectivePrincipals } } : {};

  const [principals, teamLeaders, supervisors, managers, mtdTargets] = await Promise.all([
    prisma.principal.findMany({ where: { status: "Active", ...principalWhere }, select: { principal: true, teamLeaderId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true, supervisorId: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true, managerId: true } }),
    prisma.manager.findMany({ select: { id: true, name: true } }),
    getMtdTargetByTeamLeader(year, monthLabel, effectivePrincipals),
  ]);

  const canonicalTeamLeaderIds = canonicalTeamLeaderIdMap(teamLeaders, supervisors);
  const canonicalPrincipals = principals.map((principal) => ({
    ...principal,
    teamLeaderId: principal.teamLeaderId ? (canonicalTeamLeaderIds.get(principal.teamLeaderId) ?? principal.teamLeaderId) : null,
  }));
  const canonicalMtdTargets = mtdTargets.map((target) => ({
    ...target,
    teamLeaderId: canonicalTeamLeaderIds.get(target.teamLeaderId) ?? target.teamLeaderId,
  }));
  const result = buildTlRanking(principalRevenue, canonicalPrincipals, teamLeaders, canonicalMtdTargets);

  // Composite-score inputs (Strike Rate, Distribution, JP Adherence) always
  // reflect the real current calendar month, same as achievedPct's own MTD
  // target — a QTD/YTD page selection has no bearing on this ranking.
  const { repMetricsByTeamLeader, jpAdherenceByTeamLeader } = await loadCompositeInputs(scope, year, monthLabel);
  const compositeRankings = sortByCompositeScore(computeTlCompositeScores(result.rankings, repMetricsByTeamLeader, jpAdherenceByTeamLeader));

  // TEAM_LEADER and a principal-scoped VIEWER keep today's flat shape — a single
  // Team Leader (or a flat multi-TL list with no meaningful supervisor grouping
  // narrowed further) doesn't benefit from the extra nesting.
  if (scope && (scope.teamLeaderId || !scope.supervisorId)) {
    if (scope.teamLeaderId) {
      const scopedTeamLeaderId = canonicalTeamLeaderIds.get(scope.teamLeaderId) ?? scope.teamLeaderId;
      const rankings = compositeRankings.filter((r) => r.teamLeaderId === scopedTeamLeaderId);
      return NextResponse.json({ mode: "flat", rankings, unattributedPrincipals: [] } satisfies TlRankingResponse);
    }
    // Principal-restricted VIEWER (no single TL identity of their own): show every
    // Team Leader who owns at least one allowed principal.
    // Note: mtdTarget/mtdRevenue for those visible rows still reflects each TL's full
    // cross-principal total, not narrowed to just the allowed principal — the same
    // limitation buildTlRanking has always had (no per-principal target breakdown).
    const allowedTeamLeaderIds = new Set(
      canonicalPrincipals.filter((p) => p.teamLeaderId && scope.principals.includes(p.principal)).map((p) => p.teamLeaderId!)
    );
    const rankings = compositeRankings.filter((r) => allowedTeamLeaderIds.has(r.teamLeaderId));
    return NextResponse.json({ mode: "flat", rankings, unattributedPrincipals: [] } satisfies TlRankingResponse);
  }

  // compositeRankings carries every TlRankingRow field plus the composite-score
  // fields, so passing it here still produces a valid SupervisorRankingResult/
  // ManagerRankingResult — the nested teamLeaders rows keep their composite
  // fields at runtime even though these two builders only know about the base
  // TlRankingRow shape.
  const supervisorRanking = buildSupervisorRanking(compositeRankings, teamLeaders, supervisors);
  const managerRanking = buildManagerRanking(supervisorRanking.rankings, supervisors, managers);

  if (scope?.supervisorId) {
    const rankings = supervisorRanking.rankings.filter((r) => r.supervisorId === scope.supervisorId);
    const narrowedSupervisorRanking: SupervisorRankingResult = { rankings, unassignedTeamLeaders: [] };
    const narrowedManagerRanking = buildManagerRanking(rankings, supervisors, managers);
    return NextResponse.json(
      { mode: "hierarchy", managerRanking: narrowedManagerRanking, supervisorRanking: narrowedSupervisorRanking, unattributedPrincipals: [] } satisfies TlRankingResponse
    );
  }

  // Unscoped (ADMIN or an unrestricted VIEWER): full nested hierarchy.
  return NextResponse.json({ mode: "hierarchy", managerRanking, supervisorRanking, unattributedPrincipals: result.unattributedPrincipals } satisfies TlRankingResponse);
}

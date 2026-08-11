import { teamLeaderSupervisesName } from "./teamLeaderScope";

// Team Leader Ranking — MTD Target vs MTD Revenue per Team Leader, for the
// redesigned Executive Overview (/dashboard). Revenue is attributed by which
// PRINCIPAL a Team Leader heads (Principal.teamLeaderId — admin-editable, see
// app/(protected)/admin/principals), not by matching individual reps' SAP
// names to a roster. Rep-name attribution used to break down exactly where
// SAP's own bookkeeping didn't match the org roster — confirmed live: "Eabl
// Udv town NYH RT" was a real SAP name shared by one of Erick's reps on
// EABL-Nyahururu and one of Richard's on EABL-Nyeri, so rep-name matching
// mis-split revenue between them. Principal-level attribution sidesteps this
// entirely — a principal's whole MTD revenue counts for whoever heads it,
// regardless of which SAP rep name shows up on any given invoice. This also
// means one Team Leader who heads several principals (e.g. Josephat: Bic-
// Nairobi, Unilever-Nairobi, Ukl-Intl-Nairobi) correctly gets all of them
// summed, without needing a rep on their roster for each one.
//
// TeamLeaderAssignment (the rep roster) is untouched by this file — it still
// drives RepContribution/WeeklyTarget/DailyTarget and the reporting hierarchy
// (supervisorId/managerId) below, none of which is a revenue-attribution
// concern.

export interface PrincipalRevenueInput {
  principal: string;
  revenue: number;
}

/** Which Team Leader heads a principal — sourced from the admin-editable
 *  Principal table (Principal.teamLeaderId), filtered to Active by the
 *  caller. teamLeaderId is null for a "Past"/unowned principal. */
export interface PrincipalOwnershipInput {
  principal: string;
  teamLeaderId: string | null;
}

export interface UnattributedPrincipal {
  principal: string;
  revenue: number;
}

export interface AssignmentInput {
  teamLeaderId: string;
  employeeName: string;
  sapName: string | null;
  principal: string;
  active: boolean;
  supervisorId?: string | null;
  managerId?: string | null;
}

export interface TeamLeaderInput {
  id: string;
  name: string;
}

/** Pre-aggregated MTD Target contribution per Team Leader — one row per Team
 *  Leader, already summed by the caller. In practice this is sourced from the
 *  Target x RepContribution cascade, prorated by elapsed working days — see
 *  lib/mtdTarget.ts for why a straight WeeklyTarget sum overstates MTD. Kept as a
 *  generic pair here so this function stays pure/testable regardless of where the
 *  caller sourced it from. monthlyTargetValue is optional (defaults to 0) purely
 *  so existing test fixtures that only care about mtdTarget don't need updating —
 *  the real caller (lib/mtdTarget.ts) always supplies it. */
export interface MtdTargetInput {
  teamLeaderId: string;
  targetValue: number;
  monthlyTargetValue?: number;
}

export interface TlRankingRow {
  teamLeaderId: string;
  teamLeaderName: string;
  mtdTarget: number;
  mtdRevenue: number;
  /** Full-month target this Team Leader's mtdTarget was prorated down from —
   *  summed at Supervisor/Manager level, ties out exactly to the overall month
   *  target (see MtdTargetRow.monthlyTargetValue). */
  monthlyTarget: number;
  achievedPct: number | null; // null when target is 0 (nothing to divide by)
}

export interface TlRankingResult {
  rankings: TlRankingRow[]; // sorted by achievedPct desc, unranked (null pct) last
  unattributedPrincipals: UnattributedPrincipal[]; // revenue whose principal has no active owner
}

/** Pure derivation: attributes each principal's MTD revenue wholesale to whichever
 *  Team Leader heads it (principalOwnership, filtered to Active by the caller — see
 *  the Principal.teamLeaderId comment above), sums each Team Leader's MTD target (see
 *  MtdTargetInput — elapsed days only, not the whole month), and ranks by achievement
 *  %. A principal with revenue but no active owner is reported separately rather than
 *  silently dropped or silently misattributed — same pattern as the existing
 *  unassignedRevenueReps check on /weekly-targets/contribution. */
export function buildTlRanking(
  principalRevenue: PrincipalRevenueInput[],
  principalOwnership: PrincipalOwnershipInput[],
  teamLeaders: TeamLeaderInput[],
  mtdTargets: MtdTargetInput[]
): TlRankingResult {
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const teamLeaderIdByPrincipal = new Map(principalOwnership.map((p) => [p.principal, p.teamLeaderId]));

  const revenueByTeamLeader = new Map<string, number>();
  const unattributedPrincipals: UnattributedPrincipal[] = [];

  for (const row of principalRevenue) {
    if (row.revenue === 0) continue;
    const teamLeaderId = teamLeaderIdByPrincipal.get(row.principal);
    if (!teamLeaderId) {
      unattributedPrincipals.push({ principal: row.principal, revenue: row.revenue });
      continue;
    }
    revenueByTeamLeader.set(teamLeaderId, (revenueByTeamLeader.get(teamLeaderId) ?? 0) + row.revenue);
  }

  const targetByTeamLeader = new Map<string, number>();
  const monthlyTargetByTeamLeader = new Map<string, number>();
  for (const mt of mtdTargets) {
    targetByTeamLeader.set(mt.teamLeaderId, (targetByTeamLeader.get(mt.teamLeaderId) ?? 0) + mt.targetValue);
    monthlyTargetByTeamLeader.set(mt.teamLeaderId, (monthlyTargetByTeamLeader.get(mt.teamLeaderId) ?? 0) + (mt.monthlyTargetValue ?? 0));
  }

  const teamLeaderIds = new Set([...revenueByTeamLeader.keys(), ...targetByTeamLeader.keys()]);
  const rankings: TlRankingRow[] = Array.from(teamLeaderIds).map((teamLeaderId) => {
    const mtdTarget = targetByTeamLeader.get(teamLeaderId) ?? 0;
    const mtdRevenue = revenueByTeamLeader.get(teamLeaderId) ?? 0;
    return {
      teamLeaderId,
      teamLeaderName: teamLeaderNameById.get(teamLeaderId) ?? "—",
      mtdTarget,
      mtdRevenue,
      monthlyTarget: monthlyTargetByTeamLeader.get(teamLeaderId) ?? 0,
      achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null,
    };
  });

  unattributedPrincipals.sort((a, b) => b.revenue - a.revenue);

  return { rankings: sortByAchievement(rankings), unattributedPrincipals };
}

/** Best-to-worst: highest achievedPct first, unranked (null — no target) rows last
 *  (tie-broken by raw revenue). Shared by every ranking level (Team Leader/
 *  Supervisor/Manager) so "best performed to poorest" means the same thing at
 *  every tier. */
function sortByAchievement<T extends { achievedPct: number | null; mtdRevenue: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    if (a.achievedPct === null && b.achievedPct === null) return b.mtdRevenue - a.mtdRevenue;
    if (a.achievedPct === null) return 1;
    if (b.achievedPct === null) return -1;
    return b.achievedPct - a.achievedPct;
  });
}

export interface HierarchyEntity {
  id: string;
  name: string;
}

export interface SupervisorRankingRow {
  supervisorId: string;
  supervisorName: string;
  mtdTarget: number;
  mtdRevenue: number;
  monthlyTarget: number; // sum of nested Team Leaders' monthlyTarget — see TlRankingRow
  achievedPct: number | null;
  teamLeaders: TlRankingRow[]; // drill-down, already sorted best-to-worst
}

export interface SupervisorRankingResult {
  rankings: SupervisorRankingRow[]; // sorted by achievedPct desc
  unassignedTeamLeaders: TlRankingRow[]; // Team Leaders with no resolvable Supervisor
}

/** Rolls Team-Leader-level ranking rows up to Sales Supervisor level — the primary
 *  ranking grouping (several Team Leaders can share one Supervisor, e.g. Mars-
 *  Nairobi's 5 Team Leaders all under Lucy Githinji). Team Leader detail nests
 *  underneath each Supervisor row rather than disappearing, matching "team leaders
 *  can then be tracked based on the teams and regions they head." A Team Leader's
 *  Supervisor is resolved from their own active TeamLeaderAssignment rows (first
 *  non-null supervisorId wins). This hierarchy lookup is unrelated to revenue
 *  attribution (see buildTlRanking above) and still reads TeamLeaderAssignment
 *  as before — only which principal's revenue counts for a Team Leader changed,
 *  not who they report to. */
export function buildSupervisorRanking(tlRanking: TlRankingRow[], assignments: AssignmentInput[], supervisors: HierarchyEntity[]): SupervisorRankingResult {
  const activeAssignments = assignments.filter((a) => a.active);
  const supervisorIdByTeamLeader = new Map<string, string>();
  const activeTeamLeaderIds = new Set<string>();
  for (const a of activeAssignments) {
    activeTeamLeaderIds.add(a.teamLeaderId);
    if (a.supervisorId && !supervisorIdByTeamLeader.has(a.teamLeaderId)) supervisorIdByTeamLeader.set(a.teamLeaderId, a.supervisorId);
  }
  const supervisorNameById = new Map(supervisors.map((s) => [s.id, s.name]));

  const bySupervisor = new Map<string, TlRankingRow[]>();
  const unassignedTeamLeaders: TlRankingRow[] = [];
  for (const tl of tlRanking) {
    let supervisorId = supervisorIdByTeamLeader.get(tl.teamLeaderId);
    if (!supervisorId) {
      // Legacy fallback: a Team Leader row with no roster-linked Supervisor - e.g.
      // an old monolithic "Lucy" team-leader identity carrying pre-restructuring
      // WeeklyTarget history from before the account was split into named
      // sub-team-leaders under Supervisor "Lucy Githinji" - still rolls up
      // correctly when its own name matches a Supervisor's, via the exact same
      // fuzzy rule lib/teamLeaderScope.ts's TEAM_LEADER scope expansion already
      // uses for this "coarser old identity vs newer structured hierarchy"
      // reconciliation. Only applied when exactly one Supervisor matches, so a
      // genuinely ambiguous/unrelated stray name (e.g. "Christine", "BDM") stays
      // correctly unassigned rather than guessed at.
      const matches = supervisors.filter((s) => teamLeaderSupervisesName(tl.teamLeaderName, s.name));
      if (matches.length === 1) supervisorId = matches[0].id;
    }
    if (!supervisorId) {
      // A Team Leader identity with zero currently-active reps (confirmed live:
      // "Christine," fully replaced by "Eve" on Suntory-Nairobi - her
      // TeamLeaderAssignment rows are already correctly deactivated) is stale
      // history, not a live team - drop it from the ranking (and its totals)
      // entirely rather than surfacing it as "needs a Supervisor," which it
      // doesn't, having no current team to assign one to. Its WeeklyTarget rows
      // stay in the DB untouched either way (reject-deletes) - this only affects
      // what the live ranking view surfaces. A Team Leader that DOES have an
      // active team but genuinely lacks a Supervisor link is a real, actionable
      // gap and still shows up below.
      if (activeTeamLeaderIds.has(tl.teamLeaderId)) unassignedTeamLeaders.push(tl);
      continue;
    }
    const list = bySupervisor.get(supervisorId) ?? [];
    list.push(tl);
    bySupervisor.set(supervisorId, list);
  }

  const rankings: SupervisorRankingRow[] = Array.from(bySupervisor.entries()).map(([supervisorId, teamLeaders]) => {
    const mtdTarget = teamLeaders.reduce((s, tl) => s + tl.mtdTarget, 0);
    const mtdRevenue = teamLeaders.reduce((s, tl) => s + tl.mtdRevenue, 0);
    const monthlyTarget = teamLeaders.reduce((s, tl) => s + tl.monthlyTarget, 0);
    return {
      supervisorId,
      supervisorName: supervisorNameById.get(supervisorId) ?? "—",
      mtdTarget,
      mtdRevenue,
      monthlyTarget,
      achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null,
      teamLeaders: sortByAchievement(teamLeaders),
    };
  });

  return { rankings: sortByAchievement(rankings), unassignedTeamLeaders: sortByAchievement(unassignedTeamLeaders) };
}

export interface ManagerRankingRow {
  managerId: string;
  managerName: string;
  mtdTarget: number;
  mtdRevenue: number;
  monthlyTarget: number; // sum of nested Supervisors' monthlyTarget
  achievedPct: number | null;
  supervisors: SupervisorRankingRow[]; // drill-down, already sorted best-to-worst
}

export interface ManagerRankingResult {
  rankings: ManagerRankingRow[]; // sorted by achievedPct desc
  unassignedSupervisors: SupervisorRankingRow[]; // Supervisors with no resolvable Manager
}

/** Rolls Supervisor-level rows up to Manager level — one tier further up (a Manager
 *  can span several Supervisors and even several principals, e.g. Angela Sitati
 *  over Lucy Githinji's Mars-Nairobi group plus Suntory/Upfield/Tropikal/Weetabix).
 *  Reporting/ranking dimension only — no Manager login. A Supervisor's Manager is
 *  resolved via its own nested Team Leaders' assignment rows (first match), the
 *  same "ask the leaf rows, not a separate lookup" approach buildSupervisorRanking
 *  uses. */
export function buildManagerRanking(supervisorRanking: SupervisorRankingRow[], assignments: AssignmentInput[], managers: HierarchyEntity[]): ManagerRankingResult {
  const activeAssignments = assignments.filter((a) => a.active);
  const managerIdByTeamLeader = new Map<string, string>();
  for (const a of activeAssignments) {
    if (a.managerId && !managerIdByTeamLeader.has(a.teamLeaderId)) managerIdByTeamLeader.set(a.teamLeaderId, a.managerId);
  }
  const managerNameById = new Map(managers.map((m) => [m.id, m.name]));

  const byManager = new Map<string, SupervisorRankingRow[]>();
  const unassignedSupervisors: SupervisorRankingRow[] = [];
  for (const sup of supervisorRanking) {
    // Check every nested Team Leader, not just the first (sorted-by-achievement)
    // one - a legacy fuzzy-merged Team Leader (see buildSupervisorRanking's own
    // fallback) has no assignment row of its own and so no managerId, but a
    // genuine roster-linked sibling under the same Supervisor usually does.
    let managerId = sup.teamLeaders.map((tl) => managerIdByTeamLeader.get(tl.teamLeaderId)).find((id) => id != null);
    if (!managerId) {
      const matches = managers.filter((m) => teamLeaderSupervisesName(sup.supervisorName, m.name));
      if (matches.length === 1) managerId = matches[0].id;
    }
    if (!managerId) {
      unassignedSupervisors.push(sup);
      continue;
    }
    const list = byManager.get(managerId) ?? [];
    list.push(sup);
    byManager.set(managerId, list);
  }

  const rankings: ManagerRankingRow[] = Array.from(byManager.entries()).map(([managerId, supervisors]) => {
    const mtdTarget = supervisors.reduce((s, sup) => s + sup.mtdTarget, 0);
    const mtdRevenue = supervisors.reduce((s, sup) => s + sup.mtdRevenue, 0);
    const monthlyTarget = supervisors.reduce((s, sup) => s + sup.monthlyTarget, 0);
    return {
      managerId,
      managerName: managerNameById.get(managerId) ?? "—",
      mtdTarget,
      mtdRevenue,
      monthlyTarget,
      achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null,
      supervisors: sortByAchievement(supervisors),
    };
  });

  return { rankings: sortByAchievement(rankings), unassignedSupervisors: sortByAchievement(unassignedSupervisors) };
}

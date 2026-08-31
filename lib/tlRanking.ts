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
  /** Every Active principal this Team Leader heads (Principal.teamLeaderId), sorted.
   *  Sourced from principalOwnership directly, not from principalRevenue — a
   *  principal this TL heads with zero revenue this period still counts as theirs. */
  principals: string[];
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

  const principalsByTeamLeader = new Map<string, string[]>();
  for (const p of principalOwnership) {
    if (!p.teamLeaderId) continue;
    const list = principalsByTeamLeader.get(p.teamLeaderId) ?? [];
    list.push(p.principal);
    principalsByTeamLeader.set(p.teamLeaderId, list);
  }

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
      principals: (principalsByTeamLeader.get(teamLeaderId) ?? []).slice().sort(),
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
  /** Union of every nested Team Leader's principals, deduped and sorted — the
   *  set of principals this Supervisor's group covers. */
  principals: string[];
  teamLeaders: TlRankingRow[]; // drill-down, already sorted best-to-worst
}

export interface SupervisorRankingResult {
  rankings: SupervisorRankingRow[]; // sorted by achievedPct desc
  unassignedTeamLeaders: TlRankingRow[]; // Team Leaders with no resolvable Supervisor
}

/** A Team Leader's own reporting line — TeamLeader.supervisorId, admin-editable
 *  via app/(protected)/admin/team-leaders. Replaces resolving this from
 *  TeamLeaderAssignment rows (rep-level, array-order-dependent when a Team
 *  Leader's active rows disagreed — confirmed live for Erick, whose active
 *  rows split across two different managerIds, and the "first row wins" lookup
 *  picked arbitrarily). */
export interface TeamLeaderHierarchyInput {
  id: string;
  name: string;
  supervisorId: string | null;
}

const LEGACY_ROLE_ALIASES = new Set(["bdm"]);

function normalizedHierarchyName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Resolves a legacy role label such as "BDM" to the real named Team Leader
 *  when both rows report to the same Supervisor and that Supervisor has one
 *  exact-name Team Leader row. The legacy row remains in the database for
 *  historical target/audit references, but it must not split current revenue
 *  or appear as a second person in hierarchy reports. */
export function canonicalTeamLeaderIdMap(
  teamLeaders: TeamLeaderHierarchyInput[],
  supervisors: HierarchyEntity[]
): Map<string, string> {
  const supervisorNameById = new Map(supervisors.map((supervisor) => [supervisor.id, normalizedHierarchyName(supervisor.name)]));
  const result = new Map(teamLeaders.map((teamLeader) => [teamLeader.id, teamLeader.id]));

  for (const alias of teamLeaders) {
    if (!LEGACY_ROLE_ALIASES.has(normalizedHierarchyName(alias.name)) || !alias.supervisorId) continue;
    const supervisorName = supervisorNameById.get(alias.supervisorId);
    if (!supervisorName) continue;
    const canonicalMatches = teamLeaders.filter(
      (candidate) => candidate.id !== alias.id && candidate.supervisorId === alias.supervisorId && normalizedHierarchyName(candidate.name) === supervisorName
    );
    if (canonicalMatches.length === 1) result.set(alias.id, canonicalMatches[0].id);
  }

  return result;
}

/** Rolls Team-Leader-level ranking rows up to Sales Supervisor level — the primary
 *  ranking grouping (several Team Leaders can share one Supervisor, e.g. Mars-
 *  Nairobi's 5 Team Leaders all under Lucy Githinji). Team Leader detail nests
 *  underneath each Supervisor row rather than disappearing, matching "team leaders
 *  can then be tracked based on the teams and regions they head." */
export function buildSupervisorRanking(tlRanking: TlRankingRow[], teamLeaders: TeamLeaderHierarchyInput[], supervisors: HierarchyEntity[]): SupervisorRankingResult {
  const supervisorIdByTeamLeader = new Map(teamLeaders.map((tl) => [tl.id, tl.supervisorId]));
  const supervisorNameById = new Map(supervisors.map((s) => [s.id, s.name]));

  const bySupervisor = new Map<string, TlRankingRow[]>();
  const unassignedTeamLeaders: TlRankingRow[] = [];
  for (const tl of tlRanking) {
    let supervisorId = supervisorIdByTeamLeader.get(tl.teamLeaderId);
    if (!supervisorId) {
      // Legacy fallback: a Team Leader row with no TeamLeader.supervisorId set
      // yet - e.g. an old monolithic "Lucy" team-leader identity carrying
      // pre-restructuring WeeklyTarget history from before the account was
      // split into named sub-team-leaders under Supervisor "Lucy Githinji" -
      // still rolls up correctly when its own name matches a Supervisor's, via
      // the exact same fuzzy rule lib/teamLeaderScope.ts's TEAM_LEADER scope
      // expansion already uses for this "coarser old identity vs newer
      // structured hierarchy" reconciliation. Only applied when exactly one
      // Supervisor matches, so a genuinely ambiguous/unrelated stray name
      // stays correctly unassigned rather than guessed at.
      const matches = supervisors.filter((s) => teamLeaderSupervisesName(tl.teamLeaderName, s.name));
      if (matches.length === 1) supervisorId = matches[0].id;
    }
    if (!supervisorId) {
      // A real, currently-attributed-revenue Team Leader with no resolvable
      // Supervisor is a genuine, actionable gap - surface it, never drop it.
      // (Previously this dropped a Team Leader with zero active
      // TeamLeaderAssignment rows entirely - confirmed wrong once revenue
      // became principal-based: Christine had real revenue via principal
      // ownership despite having no active reps left on her roster, and was
      // being silently discarded from every rollup along with her ~10.6M.)
      unassignedTeamLeaders.push(tl);
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
      principals: Array.from(new Set(teamLeaders.flatMap((tl) => tl.principals))).sort(),
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

/** A Supervisor's own reporting line — Supervisor.managerId, admin-editable via
 *  app/(protected)/admin/team-leaders. Same reasoning as
 *  TeamLeaderHierarchyInput above. */
export interface SupervisorHierarchyInput {
  id: string;
  name: string;
  managerId: string | null;
}

/** Rolls Supervisor-level rows up to Manager level — one tier further up (a Manager
 *  can span several Supervisors and even several principals, e.g. Angela Sitati
 *  over Lucy Githinji's Mars-Nairobi group plus Suntory/Upfield/Tropikal/Weetabix).
 *  Reporting/ranking dimension only — no Manager login. */
export function buildManagerRanking(supervisorRanking: SupervisorRankingRow[], supervisorHierarchy: SupervisorHierarchyInput[], managers: HierarchyEntity[]): ManagerRankingResult {
  const managerIdBySupervisor = new Map(supervisorHierarchy.map((s) => [s.id, s.managerId]));
  const managerNameById = new Map(managers.map((m) => [m.id, m.name]));

  const byManager = new Map<string, SupervisorRankingRow[]>();
  const unassignedSupervisors: SupervisorRankingRow[] = [];
  for (const sup of supervisorRanking) {
    let managerId = managerIdBySupervisor.get(sup.supervisorId);
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

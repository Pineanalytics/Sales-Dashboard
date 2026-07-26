// Team Leader Ranking — MTD Target vs MTD Revenue per Team Leader, for the
// redesigned Executive Overview (/dashboard). No existing rollup did this: rep-level
// revenue only exists in the Excel-sourced MonthlyBrandCustomerRow (a "salesEmployee"
// name string, via summarizeBrandCustomerByRep in lib/timeIntelligence.ts) and has to
// be joined to TeamLeaderAssignment by name — the exact Pine/SAP name-mismatch problem
// this project has hit before. TeamLeaderAssignment.sapName (ported from
// Target_Management_System.xlsm's Roster "SAP Name" column) is the intended fix: it's
// the rep's name as SAP — and therefore MonthlyBrandCustomerRow.salesEmployee — actually
// spells it, so it's tried first, falling back to employeeName (the Pine-side "Sales
// Edge Name") for any assignment that hasn't had it declared yet.

export interface RepRevenueInput {
  salesEmployee: string;
  revenue: number;
}

export interface AssignmentInput {
  teamLeaderId: string;
  employeeName: string;
  sapName: string | null;
  principal: string;
  active: boolean;
}

export interface TeamLeaderInput {
  id: string;
  name: string;
}

export interface WeeklyTargetInput {
  teamLeaderId: string;
  targetValue: number;
}

export interface TlRankingRow {
  teamLeaderId: string;
  teamLeaderName: string;
  mtdTarget: number;
  mtdRevenue: number;
  achievedPct: number | null; // null when target is 0 (nothing to divide by)
}

export interface UnmatchedRep {
  salesEmployee: string;
  revenue: number;
}

export interface TlRankingResult {
  rankings: TlRankingRow[]; // sorted by achievedPct desc, unranked (null pct) last
  unmatchedReps: UnmatchedRep[]; // revenue that couldn't be attributed to any Team Leader
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Resolves a rep name (as it appears in SAP-sourced revenue rows) to a Team Leader,
 *  preferring an assignment for `principalKey`'s principal when one is selected (a rep
 *  can report to different Team Leaders for different principals) and otherwise falling
 *  back to the rep's first active assignment. Matches sapName first, then employeeName —
 *  see file header for why. */
function resolveTeamLeaderId(salesEmployee: string, activeAssignments: AssignmentInput[], principalFilter: string | null): string | null {
  const needle = normalizeName(salesEmployee);

  const bySapName = activeAssignments.filter((a) => a.sapName && normalizeName(a.sapName) === needle);
  const byEmployeeName = activeAssignments.filter((a) => normalizeName(a.employeeName) === needle);
  const candidates = bySapName.length > 0 ? bySapName : byEmployeeName;
  if (candidates.length === 0) return null;

  if (principalFilter) {
    const forPrincipal = candidates.find((a) => a.principal === principalFilter);
    if (forPrincipal) return forPrincipal.teamLeaderId;
  }
  return candidates[0].teamLeaderId;
}

/** Pure derivation: joins rep-level MTD revenue to Team Leaders (by sapName/employeeName),
 *  sums each Team Leader's target from their WeeklyTarget rows for the period's weeks, and
 *  ranks by achievement %. Reps whose name matches no active assignment are reported
 *  separately rather than silently dropped or silently misattributed — same pattern as
 *  the existing unassignedRevenueReps check on /weekly-targets/contribution. */
export function buildTlRanking(
  repRevenue: RepRevenueInput[],
  assignments: AssignmentInput[],
  teamLeaders: TeamLeaderInput[],
  weeklyTargets: WeeklyTargetInput[],
  principalFilter: string | null
): TlRankingResult {
  const activeAssignments = assignments.filter((a) => a.active);
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));

  const revenueByTeamLeader = new Map<string, number>();
  const unmatchedReps: UnmatchedRep[] = [];

  for (const rep of repRevenue) {
    if (rep.revenue === 0) continue;
    const teamLeaderId = resolveTeamLeaderId(rep.salesEmployee, activeAssignments, principalFilter);
    if (!teamLeaderId) {
      unmatchedReps.push({ salesEmployee: rep.salesEmployee, revenue: rep.revenue });
      continue;
    }
    revenueByTeamLeader.set(teamLeaderId, (revenueByTeamLeader.get(teamLeaderId) ?? 0) + rep.revenue);
  }

  const targetByTeamLeader = new Map<string, number>();
  for (const wt of weeklyTargets) {
    targetByTeamLeader.set(wt.teamLeaderId, (targetByTeamLeader.get(wt.teamLeaderId) ?? 0) + wt.targetValue);
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
      achievedPct: mtdTarget > 0 ? (mtdRevenue / mtdTarget) * 100 : null,
    };
  });

  rankings.sort((a, b) => {
    if (a.achievedPct === null && b.achievedPct === null) return b.mtdRevenue - a.mtdRevenue;
    if (a.achievedPct === null) return 1;
    if (b.achievedPct === null) return -1;
    return b.achievedPct - a.achievedPct;
  });

  unmatchedReps.sort((a, b) => b.revenue - a.revenue);

  return { rankings, unmatchedReps };
}

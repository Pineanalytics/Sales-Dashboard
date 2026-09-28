// Supervisor-tier view of the same Contribution % this codebase already
// validates one grain down (lib/repContribution.ts's validateContributionTotals,
// which checks every active PRIMARY rep on a Principal sums to ~100% company-
// wide). This groups that same declared %, one level up, by which Team Leader
// under a given Supervisor it belongs to — "Lucy's group: Team Leader A 40%,
// Team Leader B 35%, Team Leader C 25%" — so a Supervisor's shared Primary
// Target split is visible without a new persisted target model: the shared
// Monthly Target (Target.valueTarget) already covers the whole Principal:
// contributionPct already splits it down through reps into Team Leaders; this
// is purely a read of that existing split, re-grouped by Team Leader within
// one Supervisor's own group. No DB access — pure grouping over an
// already-fetched TeamLeaderAssignment[] array, same convention as
// lib/rosterCascade.ts.

export interface SupervisorContributionAssignment {
  teamLeaderId: string;
  supervisorId: string | null;
  principal: string;
  active: boolean;
  salesRole: string;
  contributionPct: number | null;
}

export interface TeamLeaderContributionShare {
  teamLeaderId: string;
  totalPct: number; // fraction, e.g. 0.4 — sum of that Team Leader's declared shares
  repCount: number;
  hasUndeclared: boolean; // at least one active PRIMARY rep here has no declared contributionPct
}

export interface SupervisorContributionSummary {
  shares: TeamLeaderContributionShare[];
  totalPct: number; // sum across every Team Leader in this Supervisor's group, on this Principal
  reconciled: boolean; // true once every rep has a declared % and the group sums to ~100%
}

/** PRIMARY-only, active-only — same filter as validateContributionTotals, for
 *  the same reason (Secondary reps aren't part of target allocation and
 *  summing them in produces a false mismatch reading). */
export function summarizeSupervisorPrincipalContribution(
  assignments: SupervisorContributionAssignment[],
  supervisorId: string,
  principal: string
): SupervisorContributionSummary {
  const relevant = assignments.filter((a) => a.supervisorId === supervisorId && a.principal === principal && a.active && a.salesRole === "PRIMARY");

  const byTeamLeader = new Map<string, SupervisorContributionAssignment[]>();
  for (const a of relevant) {
    const list = byTeamLeader.get(a.teamLeaderId) ?? [];
    list.push(a);
    byTeamLeader.set(a.teamLeaderId, list);
  }

  const shares: TeamLeaderContributionShare[] = Array.from(byTeamLeader.entries())
    .map(([teamLeaderId, reps]) => ({
      teamLeaderId,
      totalPct: reps.reduce((sum, r) => sum + (r.contributionPct ?? 0), 0),
      repCount: reps.length,
      hasUndeclared: reps.some((r) => r.contributionPct == null),
    }))
    .sort((a, b) => b.totalPct - a.totalPct);

  const totalPct = shares.reduce((sum, s) => sum + s.totalPct, 0);
  const reconciled = shares.length > 0 && shares.every((s) => !s.hasUndeclared) && Math.abs(totalPct - 1) <= 0.001;

  return { shares, totalPct, reconciled };
}

// Pure grouping helpers over an already-fetched, already-scope-filtered
// TeamLeaderAssignment[] array — power the admin/team-leaders page's
// Team Leader -> Principal -> Rep cascading filter and its per-rep
// consolidated view. No DB access here: the page fetches assignments once
// (already scoped via resolveScopeForSession) and everything below just
// narrows/regroups that same array client-side. See docs/plans (Roster
// consolidation).

export interface CascadeAssignment {
  teamLeaderId: string;
  principal: string;
  employeeCode: string;
}

/** Distinct principals a given Team Leader has at least one assignment
 *  under, sorted for stable select-option ordering. */
export function principalsForTeamLeader<T extends CascadeAssignment>(assignments: T[], teamLeaderId: string): string[] {
  return [...new Set(assignments.filter((a) => a.teamLeaderId === teamLeaderId).map((a) => a.principal))].sort();
}

/** The rep rows visible once both a Team Leader and a Principal are
 *  selected in the cascade. */
export function assignmentsForTeamLeaderAndPrincipal<T extends CascadeAssignment>(
  assignments: T[],
  teamLeaderId: string,
  principal: string
): T[] {
  return assignments.filter((a) => a.teamLeaderId === teamLeaderId && a.principal === principal);
}

/** Every assignment row for one rep, across every Team Leader/Principal
 *  they're actively or inactively rostered under — the data behind the
 *  rep-detail consolidated view for a rep who serves more than one
 *  Team Leader/Principal at once. */
export function groupAssignmentsByEmployeeCode<T extends CascadeAssignment>(assignments: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const a of assignments) {
    const list = map.get(a.employeeCode) ?? [];
    list.push(a);
    map.set(a.employeeCode, list);
  }
  return map;
}

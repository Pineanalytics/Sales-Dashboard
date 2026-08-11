/**
 * Derives the durable Sales Supervisor → Manager reporting lines from the
 * roster assignment history. This is only used to backfill the direct HR
 * fields introduced after those assignments were already imported; normal
 * V18 roster imports keep those fields current going forward.
 */
export interface ReportingHierarchyAssignment {
  teamLeaderId: string;
  supervisorId: string | null;
  managerId: string | null;
  employeeCode: string;
  employeeName: string;
}

export interface ReportingHierarchyLinks {
  teamLeaderToSupervisor: Array<{ teamLeaderId: string; supervisorId: string }>;
  supervisorToManager: Array<{ supervisorId: string; managerId: string }>;
}

function hasRealEmployeeCode(row: ReportingHierarchyAssignment): boolean {
  return row.employeeCode.trim() !== row.employeeName.trim();
}

function weightedMajority<T extends ReportingHierarchyAssignment>(
  rows: T[],
  keyOf: (row: T) => string | null,
  valueOf: (row: T) => string | null
): Array<{ key: string; value: string }> {
  const votesByKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = keyOf(row)?.trim();
    const value = valueOf(row)?.trim();
    if (!key || !value) continue;
    const votes = votesByKey.get(key) ?? new Map<string, number>();
    votes.set(value, (votes.get(value) ?? 0) + (hasRealEmployeeCode(row) ? 2 : 1));
    votesByKey.set(key, votes);
  }

  return Array.from(votesByKey, ([key, votes]) => {
    const [value] = Array.from(votes.entries()).sort(([leftValue, leftVotes], [rightValue, rightVotes]) => rightVotes - leftVotes || leftValue.localeCompare(rightValue))[0];
    return { key, value };
  });
}

/**
 * Uses the same employee-code-weighted majority rule as the roster importer:
 * a genuine employee code counts twice, while placeholder rows (where the
 * code is just the employee name repeated) remain a weaker fallback.
 */
export function deriveReportingHierarchy(assignments: ReportingHierarchyAssignment[]): ReportingHierarchyLinks {
  return {
    teamLeaderToSupervisor: weightedMajority(assignments, (row) => row.teamLeaderId, (row) => row.supervisorId).map(({ key, value }) => ({ teamLeaderId: key, supervisorId: value })),
    supervisorToManager: weightedMajority(
      assignments,
      (row) => row.supervisorId,
      (row) => row.managerId
    ).map(({ key, value }) => ({ supervisorId: key, managerId: value })),
  };
}

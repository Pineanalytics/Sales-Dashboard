// Resolves EmployeeMaster.teamLeaderId/supervisorId — a rep's "home" Team
// Leader/Supervisor — from their active TeamLeaderAssignment rows. This is
// deliberately a different concept from TeamLeaderAssignment itself: an
// assignment row means "this Team Leader can see/allocate this rep for this
// Principal" (a rep can have several, across Team Leaders and Principals),
// while EmployeeMaster.teamLeaderId means "this rep's one canonical home
// Team Leader" (identity, not allocation). See docs/plans (Roster
// consolidation) for the full rationale.
//
// Live production profiling (2026-09-20, 217 active EmployeeMaster rows)
// before this was built: 198 reps (91%) resolve to exactly one distinct
// active Team Leader across ALL their assignments regardless of Primary/
// Secondary role; 17 have two distinct Team Leaders (genuinely ambiguous —
// a real multi-Team-Leader rep); 2 have none (no active assignment at
// all). This is why resolution considers every active role, not just
// PRIMARY, and why the ambiguous/orphaned ~9% get a worklist instead of a
// forced guess.
import { prisma } from "@/lib/db";

/** Pure: given the distinct active Team Leader ids a rep is currently
 *  assigned under (any role), returns the one unambiguous home Team Leader,
 *  or null if there are zero or more than one. */
export function resolveHomeTeamLeaderId(distinctActiveTeamLeaderIds: string[]): string | null {
  return distinctActiveTeamLeaderIds.length === 1 ? distinctActiveTeamLeaderIds[0] : null;
}

export interface EmployeeIdentityResult {
  resolvedCount: number; // EmployeeMaster rows newly filled in this pass
}

/** Fills EmployeeMaster.teamLeaderId/supervisorId for every active rep who
 *  doesn't have one yet and now resolves unambiguously — never overwrites an
 *  existing value (whether it was auto-filled earlier or an admin resolved
 *  it manually via resolveEmployeeIdentityAction), so a genuine ambiguous
 *  case stays exactly as an admin left it instead of being silently reset
 *  next time this runs. Call alongside recomputeRepContribution/
 *  recomputeDailyTargets wherever TeamLeaderAssignment can change. */
export async function resolveEmployeeIdentities(): Promise<EmployeeIdentityResult> {
  const [unresolved, activeAssignments, teamLeaders] = await Promise.all([
    prisma.employeeMaster.findMany({ where: { active: true, teamLeaderId: null }, select: { employeeCode: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, teamLeaderId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, supervisorId: true } }),
  ]);
  if (unresolved.length === 0) return { resolvedCount: 0 };

  const teamLeaderIdsByEmployee = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const set = teamLeaderIdsByEmployee.get(a.employeeCode) ?? new Set<string>();
    set.add(a.teamLeaderId);
    teamLeaderIdsByEmployee.set(a.employeeCode, set);
  }
  const supervisorIdByTeamLeader = new Map(teamLeaders.map((tl) => [tl.id, tl.supervisorId]));

  let resolvedCount = 0;
  for (const { employeeCode } of unresolved) {
    const candidateIds = Array.from(teamLeaderIdsByEmployee.get(employeeCode) ?? []);
    const teamLeaderId = resolveHomeTeamLeaderId(candidateIds);
    if (!teamLeaderId) continue; // still ambiguous or orphaned — leave for the worklist
    await prisma.employeeMaster.update({
      where: { employeeCode },
      data: { teamLeaderId, supervisorId: supervisorIdByTeamLeader.get(teamLeaderId) ?? null },
    });
    resolvedCount += 1;
  }
  return { resolvedCount };
}

export interface UnresolvedEmployeeIdentity {
  employeeCode: string;
  pineName: string;
  candidates: { teamLeaderId: string; teamLeaderName: string }[]; // empty = orphaned (no active assignment at all)
}

/** Read-only companion to resolveEmployeeIdentities, for the admin worklist
 *  — every active rep still without a resolved home Team Leader, split by
 *  whether they have zero or several candidates (the UI treats these
 *  differently: nothing to pick from vs. an actual choice to make). */
export async function getUnresolvedEmployeeIdentities(): Promise<UnresolvedEmployeeIdentity[]> {
  const [unresolved, activeAssignments, teamLeaders] = await Promise.all([
    prisma.employeeMaster.findMany({ where: { active: true, teamLeaderId: null }, select: { employeeCode: true, pineName: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, teamLeaderId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
  ]);
  if (unresolved.length === 0) return [];

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const teamLeaderIdsByEmployee = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const set = teamLeaderIdsByEmployee.get(a.employeeCode) ?? new Set<string>();
    set.add(a.teamLeaderId);
    teamLeaderIdsByEmployee.set(a.employeeCode, set);
  }

  return unresolved.map(({ employeeCode, pineName }) => ({
    employeeCode,
    pineName,
    candidates: Array.from(teamLeaderIdsByEmployee.get(employeeCode) ?? []).map((teamLeaderId) => ({
      teamLeaderId,
      teamLeaderName: teamLeaderNameById.get(teamLeaderId) ?? teamLeaderId,
    })),
  }));
}

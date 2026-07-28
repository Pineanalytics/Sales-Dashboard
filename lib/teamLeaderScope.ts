import { prisma } from "./db";

/** A Team Leader's own data scope, resolved from their active
 *  TeamLeaderAssignment rows — the join key set every principal/rep-scoped
 *  route or tool filters against. Shared by lib/frost/tools.ts and every
 *  Prisma-backed dashboard route that needs to restrict a TEAM_LEADER
 *  session to their own team, rather than each call site re-deriving TL
 *  scope independently. `null` (the caller's own responsibility to check)
 *  means "no restriction" — admin, or a VIEWER with page access but no
 *  team of their own. */
export interface TeamLeaderScope {
  teamLeaderId: string;
  principals: string[];
  employeeCodes: string[];
  normalizedNames: Set<string>; // lowercased employeeName + sapName, for rows that only carry a name
}

export async function loadTeamLeaderScope(teamLeaderId: string): Promise<TeamLeaderScope> {
  const assignments = await prisma.teamLeaderAssignment.findMany({
    where: { teamLeaderId, active: true },
    select: { principal: true, employeeCode: true, employeeName: true, sapName: true },
  });
  const principals = Array.from(new Set(assignments.map((a) => a.principal)));
  const employeeCodes = Array.from(new Set(assignments.map((a) => a.employeeCode)));
  const normalizedNames = new Set<string>();
  for (const a of assignments) {
    normalizedNames.add(a.employeeName.trim().toLowerCase());
    if (a.sapName) normalizedNames.add(a.sapName.trim().toLowerCase());
  }
  return { teamLeaderId, principals, employeeCodes, normalizedNames };
}

/** Resolves a request's TeamLeaderScope from session fields, or null when
 *  the caller isn't a scoped TEAM_LEADER (admin, or no team linked yet).
 *  Shared helper so every route applies the exact same rule for "should
 *  this session be scoped at all." */
export async function resolveScopeForSession(role: string, teamLeaderId: string | null): Promise<TeamLeaderScope | null> {
  if (role !== "TEAM_LEADER" || !teamLeaderId) return null;
  return loadTeamLeaderScope(teamLeaderId);
}

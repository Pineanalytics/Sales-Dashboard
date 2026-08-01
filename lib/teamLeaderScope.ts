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

/** Matches a TeamLeader row's (often short, e.g. "Lucy") name against the
 *  Employee Roaster's "Supervisor" column (often a full name, e.g. "Lucy
 *  Githinji") — bidirectional so it also holds when TeamLeader.name is
 *  already the full name. Exported so the matching rule itself is
 *  unit-testable without a database. */
export function teamLeaderSupervisesName(teamLeaderName: string, supervisorName: string): boolean {
  const a = teamLeaderName.trim().toLowerCase();
  const b = supervisorName.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

export async function loadTeamLeaderScope(teamLeaderId: string): Promise<TeamLeaderScope> {
  const [teamLeader, assignments] = await Promise.all([
    prisma.teamLeader.findUnique({ where: { id: teamLeaderId }, select: { name: true } }),
    prisma.teamLeaderAssignment.findMany({
      where: { teamLeaderId, active: true },
      select: { principal: true, employeeCode: true, employeeName: true, sapName: true },
    }),
  ]);

  const principals = new Set<string>(assignments.map((a) => a.principal));
  const employeeCodes = new Set<string>(assignments.map((a) => a.employeeCode));
  const normalizedNames = new Set<string>();
  for (const a of assignments) {
    normalizedNames.add(a.employeeName.trim().toLowerCase());
    if (a.sapName) normalizedNames.add(a.sapName.trim().toLowerCase());
  }

  // A supervisor (Employee Roaster's "Supervisor" column — e.g. Lucy Githinji
  // over several Mars-Nairobi team leaders) owns the union of every rep under
  // their supervision, spanning every sub-team-leader's own allocations, not
  // just their own direct TeamLeaderAssignment rows (typically empty, or a
  // legacy leftover unrelated to who they actually supervise today).
  if (teamLeader) {
    const active = await prisma.employeeMaster.findMany({
      where: { active: true, supervisor: { not: null } },
      select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, supervisor: true, contributions: { select: { principal: true } } },
    });
    for (const employee of active) {
      if (!employee.supervisor || !teamLeaderSupervisesName(teamLeader.name, employee.supervisor)) continue;
      employeeCodes.add(employee.employeeCode);
      principals.add(employee.absolutePrincipal);
      for (const c of employee.contributions) principals.add(c.principal);
      normalizedNames.add(employee.pineName.trim().toLowerCase());
      normalizedNames.add(employee.sapName.trim().toLowerCase());
    }
  }

  return { teamLeaderId, principals: Array.from(principals), employeeCodes: Array.from(employeeCodes), normalizedNames };
}

/** Resolves a request's TeamLeaderScope from session fields, or null when
 *  the caller isn't a scoped TEAM_LEADER (admin, or no team linked yet).
 *  Shared helper so every route applies the exact same rule for "should
 *  this session be scoped at all." */
export async function resolveScopeForSession(role: string, teamLeaderId: string | null): Promise<TeamLeaderScope | null> {
  if (role !== "TEAM_LEADER" || !teamLeaderId) return null;
  return loadTeamLeaderScope(teamLeaderId);
}

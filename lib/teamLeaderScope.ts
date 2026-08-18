import { prisma } from "./db";

/** A restricted session's own data scope — either a Team Leader's, resolved
 *  from their active TeamLeaderAssignment rows, or a principal-restricted
 *  VIEWER's, resolved from User.allowedPrincipals — the join key set every
 *  principal/rep-scoped route or tool filters against. Shared by
 *  lib/frost/tools.ts and every Prisma-backed dashboard route that needs to
 *  restrict a session to its own slice, rather than each call site
 *  re-deriving scope independently. `null` (the caller's own responsibility
 *  to check) means "no restriction" — admin, or a session with neither a
 *  team nor a principal restriction of its own.
 *
 *  `teamLeaderId` is null for a principal-scoped VIEWER (they have no team-
 *  leader identity of their own) — any call site that narrows further by
 *  "my own TL row" (e.g. TL Ranking, WeeklyTarget) must treat a null
 *  teamLeaderId as "don't narrow by identity, only by principals". */
export interface TeamLeaderScope {
  teamLeaderId: string | null;
  /** SUPERVISOR-only — the Supervisor row's own id (null for every other scope kind). */
  supervisorId: string | null;
  /** Every Team Leader id this scope covers: [teamLeaderId] for TEAM_LEADER, every
   *  Team Leader under a Supervisor for SUPERVISOR, [] for a principal-scoped VIEWER
   *  (no team-leader identity of their own). The list a SUPERVISOR-scoped write
   *  action checks row-ownership against (e.g. admin/team-leaders/actions.ts). */
  teamLeaderIds: string[];
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

interface TeamLeaderBaseScope {
  principals: Set<string>;
  employeeCodes: Set<string>;
  normalizedNames: Set<string>;
}

/** A Team Leader's own scope — their direct TeamLeaderAssignment rows plus
 *  every rep under their EmployeeMaster.supervisor name match — with no
 *  relief coverage folded in. Extracted from loadTeamLeaderScope so relief
 *  coverage (below) can union in a *covered* Team Leader's own base scope
 *  without recursing into scope THEY might in turn be covering for. */
async function loadTeamLeaderBaseScope(teamLeaderId: string): Promise<TeamLeaderBaseScope> {
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

  return { principals, employeeCodes, normalizedNames };
}

/** Team Leader ids this Team Leader is *currently* covering for — "Benson
 *  relieves Calvince" / "holding fort" (TeamLeaderRelief), active meaning
 *  not revoked and within its optional start/end window. Peer-to-peer and
 *  admin/supervisor-allocated — deliberately separate from
 *  TeamLeader.supervisorId (a permanent reporting-line fact, not a temporary
 *  cover arrangement). */
export async function getActiveReliefCoverage(teamLeaderId: string): Promise<string[]> {
  const now = new Date();
  const reliefs = await prisma.teamLeaderRelief.findMany({
    where: {
      coveringTeamLeaderId: teamLeaderId,
      revokedAt: null,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    select: { coveredTeamLeaderId: true },
  });
  return reliefs.map((r) => r.coveredTeamLeaderId);
}

export async function loadTeamLeaderScope(teamLeaderId: string): Promise<TeamLeaderScope> {
  const coveredTeamLeaderIds = await getActiveReliefCoverage(teamLeaderId);
  const ownScope = await loadTeamLeaderBaseScope(teamLeaderId);
  // One level only — a covered Team Leader's own *base* scope, not anyone
  // they might in turn be covering for (see loadTeamLeaderBaseScope's own
  // comment on why this stays non-recursive).
  const coveredScopes = await Promise.all(coveredTeamLeaderIds.map(loadTeamLeaderBaseScope));

  const principals = new Set(ownScope.principals);
  const employeeCodes = new Set(ownScope.employeeCodes);
  const normalizedNames = new Set(ownScope.normalizedNames);
  for (const covered of coveredScopes) {
    for (const p of covered.principals) principals.add(p);
    for (const c of covered.employeeCodes) employeeCodes.add(c);
    for (const n of covered.normalizedNames) normalizedNames.add(n);
  }

  return {
    teamLeaderId,
    supervisorId: null,
    teamLeaderIds: [teamLeaderId, ...coveredTeamLeaderIds],
    principals: Array.from(principals),
    employeeCodes: Array.from(employeeCodes),
    normalizedNames,
  };
}

/** A principal-restricted VIEWER's scope — every rep whose absolute principal
 *  or contribution membership matches one of their allowed principals, mirroring
 *  how JP Adherence's own "contribution is authoritative for principal
 *  membership" rule already resolves principal->rep membership elsewhere.
 *  teamLeaderId is null: this session has no team-leader identity of its own,
 *  only a principal restriction. */
export async function loadViewerPrincipalScope(allowedPrincipals: string[]): Promise<TeamLeaderScope> {
  const principals = Array.from(new Set(allowedPrincipals));
  const employees = await prisma.employeeMaster.findMany({
    where: { active: true },
    select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, contributions: { select: { principal: true } } },
  });

  const employeeCodes = new Set<string>();
  const normalizedNames = new Set<string>();
  for (const e of employees) {
    const matches = principals.includes(e.absolutePrincipal) || e.contributions.some((c) => principals.includes(c.principal));
    if (!matches) continue;
    employeeCodes.add(e.employeeCode);
    normalizedNames.add(e.pineName.trim().toLowerCase());
    normalizedNames.add(e.sapName.trim().toLowerCase());
  }

  return { teamLeaderId: null, supervisorId: null, teamLeaderIds: [], principals, employeeCodes: Array.from(employeeCodes), normalizedNames };
}

/** A Sales Supervisor's scope — every active TeamLeaderAssignment row under their
 *  Supervisor id (a direct FK query, unlike loadTeamLeaderScope's fuzzy
 *  EmployeeMaster.supervisor name-matching — see this file's header note). Covers
 *  every Team Leader/rep/principal their group touches, across however many Team
 *  Leaders report to them. */
export async function loadSupervisorScope(supervisorId: string): Promise<TeamLeaderScope> {
  const assignments = await prisma.teamLeaderAssignment.findMany({
    where: { supervisorId, active: true },
    select: { teamLeaderId: true, principal: true, employeeCode: true, employeeName: true, sapName: true },
  });

  const teamLeaderIds = new Set<string>();
  const principals = new Set<string>();
  const employeeCodes = new Set<string>();
  const normalizedNames = new Set<string>();
  for (const a of assignments) {
    teamLeaderIds.add(a.teamLeaderId);
    principals.add(a.principal);
    employeeCodes.add(a.employeeCode);
    normalizedNames.add(a.employeeName.trim().toLowerCase());
    if (a.sapName) normalizedNames.add(a.sapName.trim().toLowerCase());
  }

  return {
    teamLeaderId: null,
    supervisorId,
    teamLeaderIds: Array.from(teamLeaderIds),
    principals: Array.from(principals),
    employeeCodes: Array.from(employeeCodes),
    normalizedNames,
  };
}

/** Resolves a request's TeamLeaderScope from session fields, or null when the
 *  caller isn't scoped at all (admin, an unrestricted VIEWER, or a TEAM_LEADER/
 *  SUPERVISOR with no team/group linked yet). Shared helper so every route applies
 *  the exact same rule for "should this session be scoped at all." */
export async function resolveScopeForSession(
  role: string,
  teamLeaderId: string | null,
  allowedPrincipals?: string[],
  supervisorId?: string | null
): Promise<TeamLeaderScope | null> {
  if (role === "SUPERVISOR" && supervisorId) return loadSupervisorScope(supervisorId);
  if (role === "TEAM_LEADER" && teamLeaderId) return loadTeamLeaderScope(teamLeaderId);
  if (role === "VIEWER" && allowedPrincipals && allowedPrincipals.length > 0) return loadViewerPrincipalScope(allowedPrincipals);
  return null;
}

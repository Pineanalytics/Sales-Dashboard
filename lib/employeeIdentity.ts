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

/** A name reduced for matching: lower-case letters and digits only, single-spaced. */
export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when an employee code is really a name — it holds a space, or it is
 *  the record's own Pine name (e.g. "Gloria Mutheu", "VAN 1 WEETABIX - KDL
 *  904E"). Real roster codes are short identifiers like "1181". */
export function codeLooksLikeName(employeeCode: string, pineName: string): boolean {
  const code = employeeCode.trim();
  return /\s/.test(code) || (code.length > 0 && normalizePersonName(code) === normalizePersonName(pineName));
}

export interface SameNameMatch {
  employeeCode: string;
  pineName: string;
  teamLeaderId: string | null;
  teamLeaderName: string | null;
}

/** Pure: other roster records that share a name with `target` — its Pine
 *  name, SAP name, or (when the code is a name) its code — so a stray
 *  duplicate record can be recognised as the same person. Records that have
 *  a home Team Leader come first. */
export function findSameNameMatches(
  target: { employeeCode: string; pineName: string; sapName: string },
  others: { employeeCode: string; pineName: string; sapName: string; teamLeaderId: string | null }[],
  teamLeaderNameById: Map<string, string>
): SameNameMatch[] {
  const names = new Set([target.pineName, target.sapName, target.employeeCode].map(normalizePersonName).filter((name) => name.includes(" ")));
  if (names.size === 0) return [];
  return others
    .filter((other) => other.employeeCode !== target.employeeCode)
    .filter((other) => names.has(normalizePersonName(other.pineName)) || names.has(normalizePersonName(other.sapName)))
    .sort((a, b) => Number(Boolean(b.teamLeaderId)) - Number(Boolean(a.teamLeaderId)) || a.employeeCode.localeCompare(b.employeeCode))
    .map((other) => ({
      employeeCode: other.employeeCode,
      pineName: other.pineName,
      teamLeaderId: other.teamLeaderId,
      teamLeaderName: other.teamLeaderId ? (teamLeaderNameById.get(other.teamLeaderId) ?? null) : null,
    }));
}

export interface UnresolvedEmployeeIdentity {
  employeeCode: string;
  pineName: string;
  candidates: { teamLeaderId: string; teamLeaderName: string }[]; // empty = orphaned (no active assignment at all)
  /** The code holds a name rather than a roster code — usually a record created by mistake. */
  codeLooksLikeName: boolean;
  /** Other roster records with the same name (the likely real person), resolved ones first. */
  sameNameMatches: SameNameMatch[];
  /** Timestamp calls logged under this exact code in the last 90 days: 0 means deleting it loses nothing current. */
  recentCalls: number;
}

/** Read-only companion to resolveEmployeeIdentities, for the admin worklist
 *  — every active rep still without a resolved home Team Leader, split by
 *  whether they have zero or several candidates (the UI treats these
 *  differently: nothing to pick from vs. an actual choice to make). Each row
 *  also says whether it looks like a stray duplicate of a real rep, so the
 *  admin can link it to that rep's Team Leader or remove it. */
export async function getUnresolvedEmployeeIdentities(): Promise<UnresolvedEmployeeIdentity[]> {
  const [unresolved, activeAssignments, teamLeaders] = await Promise.all([
    prisma.employeeMaster.findMany({ where: { active: true, teamLeaderId: null }, select: { employeeCode: true, pineName: true, sapName: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, teamLeaderId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
  ]);
  if (unresolved.length === 0) return [];

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const [others, callCounts] = await Promise.all([
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true, teamLeaderId: true } }),
    prisma.repCall.groupBy({ by: ["employeeCode"], where: { employeeCode: { in: unresolved.map((row) => row.employeeCode) }, date: { gte: since } }, _count: { _all: true } }),
  ]);
  const recentCallsByCode = new Map(callCounts.map((row) => [row.employeeCode, row._count._all]));

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const teamLeaderIdsByEmployee = new Map<string, Set<string>>();
  for (const a of activeAssignments) {
    const set = teamLeaderIdsByEmployee.get(a.employeeCode) ?? new Set<string>();
    set.add(a.teamLeaderId);
    teamLeaderIdsByEmployee.set(a.employeeCode, set);
  }

  return unresolved.map(({ employeeCode, pineName, sapName }) => ({
    employeeCode,
    pineName,
    candidates: Array.from(teamLeaderIdsByEmployee.get(employeeCode) ?? []).map((teamLeaderId) => ({
      teamLeaderId,
      teamLeaderName: teamLeaderNameById.get(teamLeaderId) ?? teamLeaderId,
    })),
    codeLooksLikeName: codeLooksLikeName(employeeCode, pineName),
    sameNameMatches: findSameNameMatches({ employeeCode, pineName, sapName }, others, teamLeaderNameById),
    recentCalls: recentCallsByCode.get(employeeCode) ?? 0,
  }));
}

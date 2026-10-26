// Who may use the outlet cleanup, and on whose outlets. A team leader works on the outlets whose selling rep is on their team; a supervisor on their team
// leaders' outlets; an admin on all of them (and is the only one who validates, applies, reopens locked fields and sets targets); HOD and Director see
// everything but do not edit.
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizeTeamLeaderKind } from "@/lib/teamLeaderKind";
import type { CleanupActor } from "./types";

export type CleanupAccess = { ok: true; actor: CleanupActor } | { ok: false; status: 401 | 403 };

const VIEW_ALL_ROLES = new Set(["ADMIN", "HOD", "DIRECTOR"]);

/** The roles that use the cleanup. Anyone else gets a 403. */
export function cleanupRoleAllowed(role: string | null | undefined): boolean {
  return role === "TEAM_LEADER" || role === "SUPERVISOR" || (role !== null && role !== undefined && VIEW_ALL_ROLES.has(role));
}

export async function resolveCleanupActor(): Promise<CleanupAccess> {
  const session = await auth();
  const user = session?.user;
  if (!user?.email) return { ok: false, status: 401 };
  const role = user.role;
  if (!cleanupRoleAllowed(role)) return { ok: false, status: 403 };

  const isAdmin = role === "ADMIN";
  if (VIEW_ALL_ROLES.has(role)) {
    return { ok: true, actor: { email: user.email, role, isAdmin, canReview: isAdmin, canSeeAll: true, teamLeaders: null, displayName: user.name ?? null } };
  }

  if (role === "TEAM_LEADER") {
    if (!user.teamLeaderId) return { ok: false, status: 403 };
    const leader = await prisma.teamLeader.findUnique({ where: { id: user.teamLeaderId }, select: { name: true } });
    if (!leader) return { ok: false, status: 403 };
    return { ok: true, actor: { email: user.email, role, isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: [leader.name], displayName: leader.name } };
  }

  // SUPERVISOR: every team leader (and the supervisor's own direct team) under them.
  if (!user.supervisorId) return { ok: false, status: 403 };
  const [supervisor, team] = await Promise.all([
    prisma.supervisor.findUnique({ where: { id: user.supervisorId }, select: { name: true } }),
    prisma.teamLeader.findMany({ where: { supervisorId: user.supervisorId }, select: { name: true, kind: true } }),
  ]);
  if (!supervisor) return { ok: false, status: 403 };
  const names = new Set(team.filter((t) => normalizeTeamLeaderKind(t.kind) !== "FORMER").map((t) => t.name));
  names.add(supervisor.name); // a supervisor who runs a principal directly is a roster row under their own name
  return { ok: true, actor: { email: user.email, role, isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: [...names], displayName: supervisor.name } };
}

/** Whether a team leader name (as the universe spells it) is one this person works on. */
export function inActorScope(actor: CleanupActor, teamLeader: string | null | undefined): boolean {
  if (actor.teamLeaders === null) return true;
  const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const wanted = fold(teamLeader ?? "");
  return wanted !== "" && actor.teamLeaders.some((name) => fold(name) === wanted);
}

/** An admin or a supervisor of the team may reopen a field a team leader has locked. */
export function canReopen(actor: CleanupActor): boolean {
  return actor.isAdmin || actor.role === "SUPERVISOR";
}

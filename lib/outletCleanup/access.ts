// Who may use the outlet cleanup, and on whose outlets. A team leader works on the outlets whose selling rep is on their team; a supervisor on their team
// leaders' outlets; an admin on all of them (and is the only one who validates, applies, reopens locked fields and sets targets); HOD and Director see
// everything but do not edit.
import { AsyncLocalStorage } from "node:async_hooks";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessOutletCleanup } from "@/lib/pageAccess";
import { normalizeTeamLeaderKind } from "@/lib/teamLeaderKind";
import type { CleanupActor } from "./types";

export type CleanupAccess = { ok: true; actor: CleanupActor } | { ok: false; status: 401 | 403 };

const VIEW_ALL_ROLES = new Set(["ADMIN", "HOD", "DIRECTOR"]);

/** The roles that use the cleanup. Anyone else gets a 403. */
export function cleanupRoleAllowed(role: string | null | undefined): boolean {
  return canAccessOutletCleanup(role);
}

// The Coaching app's bridge route (app/api/integrations/coaching/cleanup) runs the cleanup's own handlers as a person it vouches for: it checks the shared key,
// resolves that person here and runs the handler inside this store. Nothing else ever sets it, so a browser session can never reach it.
const bridged = new AsyncLocalStorage<CleanupActor>();

export function runAsBridgeActor<T>(actor: CleanupActor, run: () => Promise<T>): Promise<T> {
  return bridged.run(actor, run);
}

export async function resolveCleanupActor(): Promise<CleanupAccess> {
  const viaBridge = bridged.getStore();
  if (viaBridge) return { ok: true, actor: viaBridge };
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

/** Whether this person may approve or send back a sales rep's submission: the rep's team leader, a supervisor over them, or an admin (always within their own scope). */
export function mayApprove(actor: CleanupActor): boolean {
  return actor.isAdmin || actor.role === "TEAM_LEADER" || actor.role === "SUPERVISOR";
}

/** Whether this person may validate or send back saved work: an admin, or a supervisor for the team leaders under them (never their own work). */
export function mayValidate(actor: CleanupActor): boolean {
  return actor.isAdmin || actor.role === "SUPERVISOR";
}

/** Whether an outlet row is one this person works on: a rep's own rows (by user code), otherwise the rows of their teams. */
export function rowInScope(actor: CleanupActor, row: { teamLeader: string | null | undefined; repCode?: string | null }): boolean {
  if (actor.repCodes) return !!row.repCode && actor.repCodes.includes(row.repCode);
  return inActorScope(actor, row.teamLeader);
}

// ---------------------------------------------------------------- who the Coaching app says is asking

export interface BridgeIdentity {
  role: "TEAM_LEADER" | "SUPERVISOR" | "REP" | "HOD" | "DIRECTOR";
  /** The team leader's or supervisor's name as this application spells it (TeamLeader.name, Supervisor.name). */
  name?: string;
  /** The rep's own user code (EmployeeMaster.employeeCode). */
  repCode?: string;
  /** The person's login in the Coaching app: it labels their drafts and the log. */
  email: string;
}

const sameName = (value: string) => ({ equals: value.trim().replace(/\s+/g, " "), mode: "insensitive" as const });

/** Turns what the Coaching app asserts into the same actor a signed-in user of this application would be, checking the person against the roster tables. */
export async function resolveBridgeActor(identity: BridgeIdentity): Promise<CleanupAccess> {
  const email = (identity.email ?? "").trim().toLowerCase();
  if (!email || email.length > 160) return { ok: false, status: 401 };

  if (identity.role === "HOD" || identity.role === "DIRECTOR") {
    return { ok: true, actor: { email, role: identity.role, isAdmin: false, canReview: false, canSeeAll: true, teamLeaders: null, displayName: identity.name ?? null } };
  }

  if (identity.role === "TEAM_LEADER") {
    if (!identity.name) return { ok: false, status: 403 };
    const leader = await prisma.teamLeader.findFirst({ where: { name: sameName(identity.name) }, select: { name: true } });
    if (!leader) return { ok: false, status: 403 };
    return { ok: true, actor: { email, role: "TEAM_LEADER", isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: [leader.name], displayName: leader.name } };
  }

  if (identity.role === "SUPERVISOR") {
    if (!identity.name) return { ok: false, status: 403 };
    const supervisor = await prisma.supervisor.findFirst({ where: { name: sameName(identity.name) }, select: { id: true, name: true } });
    if (!supervisor) return { ok: false, status: 403 };
    const team = await prisma.teamLeader.findMany({ where: { supervisorId: supervisor.id }, select: { name: true, kind: true } });
    const names = new Set(team.filter((t) => normalizeTeamLeaderKind(t.kind) !== "FORMER").map((t) => t.name));
    names.add(supervisor.name);
    return { ok: true, actor: { email, role: "SUPERVISOR", isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: [...names], displayName: supervisor.name } };
  }

  // REP: only the outlets they sell, identified by their own user code on the roster.
  const code = (identity.repCode ?? "").trim();
  if (!code) return { ok: false, status: 403 };
  const rep = await prisma.employeeMaster.findFirst({ where: { employeeCode: code, active: true }, select: { employeeCode: true, pineName: true, teamLeader: true } });
  if (!rep) return { ok: false, status: 403 };
  return {
    ok: true,
    actor: { email, role: "REP", isAdmin: false, canReview: true, canSeeAll: false, teamLeaders: rep.teamLeader ? [rep.teamLeader] : [], repCodes: [rep.employeeCode], displayName: rep.pineName },
  };
}

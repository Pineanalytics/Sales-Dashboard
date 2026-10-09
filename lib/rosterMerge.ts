// Collapses two Team Leader (or two Supervisor) rows that represent the same
// real person — a repeat spelling variant from a CSV import (e.g. "Eve" /
// "Eve Theuri") — into one. TeamLeader/Supervisor identity is name-based
// ("name String @unique", no login/HR id to key off), so a variant spelling
// in a source file creates a second row rather than erroring; nothing
// reconciles that automatically. This is the admin-triggered fix.
//
// Every table that references the loser's id by plain string ("id-by-
// convention", this schema's usual pattern — see e.g. TeamLeaderAssignment's
// own header comment) gets reassigned to the winner's id, inside one
// transaction so a partial failure can't leave data half-reassigned.
// TeamLeaderAssignmentAuditLog/WeeklyTargetAuditLog keep pointing at the old
// id either way — audit history, left alone by this codebase's own
// convention (see e.g. deleteTeamLeaderAction's comment on WeeklyTarget/
// DailyTarget history). RepContribution/DailyTarget are never reassigned
// directly — they're full-replace-computed from TeamLeaderAssignment (see
// lib/repContribution.ts's own header comment), so the caller just needs to
// call recomputeRosterDerived() once after the transaction commits and they
// come out correct on their own.
//
// A genuine conflict (both sides declare the same fact, e.g. two WeeklyTarget
// rows for the same week, or two logins each linked to one side) can't be
// silently resolved — that one row is left pointing at the loser and
// reported back by name/detail. Crucially, these ids aren't real foreign
// keys (no @relation, no DB-level constraint) — deleting the loser row while
// anything still points at it would silently orphan that row rather than
// fail loudly, so the loser row is only ever deleted once nothing
// references it any more. A merge that hits a conflict finishes everything
// else it safely can and leaves the (now mostly empty) loser row in place;
// running the same merge again after the admin resolves the conflict
// deletes it.
import { prisma } from "./db";

export interface MergeResult {
  winnerName: string;
  loserName: string;
  reassigned: Record<string, number>;
  conflicts: string[];
  loserDeleted: boolean;
}

/** Merges `loserId` into `winnerId` — every TeamLeaderAssignment,
 *  TeamLeaderRelief, PerformanceTracker, Principal.teamLeaderId,
 *  EmployeeMaster.teamLeaderId, WeeklyTarget, and (where unambiguous)
 *  User.teamLeaderId that pointed at `loserId` now points at `winnerId`;
 *  the loser TeamLeader row is then deleted, unless a conflict left
 *  something still pointing at it. */
export async function mergeTeamLeaders(winnerId: string, loserId: string): Promise<MergeResult> {
  if (winnerId === loserId) throw new Error("Choose two different Team Leaders to merge.");

  const [winner, loser] = await Promise.all([
    prisma.teamLeader.findUnique({ where: { id: winnerId }, select: { name: true } }),
    prisma.teamLeader.findUnique({ where: { id: loserId }, select: { name: true } }),
  ]);
  if (!winner || !loser) throw new Error("Team Leader not found.");

  const reassigned: Record<string, number> = {};
  const conflicts: string[] = [];
  let loserDeleted = false;

  await prisma.$transaction(async (tx) => {
    // TeamLeaderAssignment — unique on (teamLeaderId, employeeCode, principal);
    // a row the winner already has for the same rep/principal can't be
    // blindly overwritten, so it's left on the loser.
    const loserAssignments = await tx.teamLeaderAssignment.findMany({
      where: { teamLeaderId: loserId },
      select: { id: true, employeeCode: true, principal: true, employeeName: true },
    });
    const winnerAssignmentKeys = new Set(
      (await tx.teamLeaderAssignment.findMany({ where: { teamLeaderId: winnerId }, select: { employeeCode: true, principal: true } })).map(
        (a) => `${a.employeeCode}|${a.principal}`
      )
    );
    let assignmentsMoved = 0;
    for (const a of loserAssignments) {
      const key = `${a.employeeCode}|${a.principal}`;
      if (winnerAssignmentKeys.has(key)) {
        conflicts.push(`${a.employeeName} (${a.principal}) is on both — left under ${loser.name}, resolve manually.`);
        continue;
      }
      await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { teamLeaderId: winnerId } });
      assignmentsMoved++;
    }
    reassigned.teamLeaderAssignments = assignmentsMoved;

    // TeamLeaderRelief — reassign both directions; drop any row that would
    // become "winner relieves winner" once both sides point at the same id.
    const reliefs = await tx.teamLeaderRelief.findMany({
      where: { OR: [{ coveringTeamLeaderId: loserId }, { coveredTeamLeaderId: loserId }] },
    });
    let reliefsMoved = 0;
    for (const r of reliefs) {
      const nextCovering = r.coveringTeamLeaderId === loserId ? winnerId : r.coveringTeamLeaderId;
      const nextCovered = r.coveredTeamLeaderId === loserId ? winnerId : r.coveredTeamLeaderId;
      if (nextCovering === nextCovered) {
        await tx.teamLeaderRelief.delete({ where: { id: r.id } });
        continue;
      }
      await tx.teamLeaderRelief.update({ where: { id: r.id }, data: { coveringTeamLeaderId: nextCovering, coveredTeamLeaderId: nextCovered } });
      reliefsMoved++;
    }
    reassigned.reliefs = reliefsMoved;

    // PerformanceTracker — unique on (type, periodMonth, teamLeaderId); a
    // period the winner already has their own tracker for is left on the
    // loser rather than overwriting a real scored period.
    const loserTrackers = await tx.performanceTracker.findMany({ where: { teamLeaderId: loserId }, select: { id: true, type: true, periodMonth: true } });
    const winnerTrackerKeys = new Set(
      (await tx.performanceTracker.findMany({ where: { teamLeaderId: winnerId }, select: { type: true, periodMonth: true } })).map(
        (t) => `${t.type}|${t.periodMonth}`
      )
    );
    let trackersMoved = 0;
    for (const t of loserTrackers) {
      const key = `${t.type}|${t.periodMonth}`;
      if (winnerTrackerKeys.has(key)) {
        conflicts.push(`${t.type} tracker for ${t.periodMonth} exists on both — left under ${loser.name}, resolve manually.`);
        continue;
      }
      await tx.performanceTracker.update({ where: { id: t.id }, data: { teamLeaderId: winnerId } });
      trackersMoved++;
    }
    reassigned.performanceTrackers = trackersMoved;

    // WeeklyTarget — unique on (teamLeaderId, principal, weekStartDate); a
    // week the winner already has a declared target for is left on the loser
    // rather than silently overwriting a real admin-entered figure.
    const loserWeeklyTargets = await tx.weeklyTarget.findMany({ where: { teamLeaderId: loserId }, select: { id: true, principal: true, weekStartDate: true } });
    const winnerWeeklyKeys = new Set(
      (await tx.weeklyTarget.findMany({ where: { teamLeaderId: winnerId }, select: { principal: true, weekStartDate: true } })).map(
        (w) => `${w.principal}|${w.weekStartDate.getTime()}`
      )
    );
    let weeklyTargetsMoved = 0;
    for (const w of loserWeeklyTargets) {
      const key = `${w.principal}|${w.weekStartDate.getTime()}`;
      if (winnerWeeklyKeys.has(key)) {
        conflicts.push(`Weekly Target for ${w.principal} (${w.weekStartDate.toISOString().slice(0, 10)}) exists on both — left under ${loser.name}, resolve manually.`);
        continue;
      }
      await tx.weeklyTarget.update({ where: { id: w.id }, data: { teamLeaderId: winnerId } });
      weeklyTargetsMoved++;
    }
    reassigned.weeklyTargets = weeklyTargetsMoved;

    reassigned.principals = (await tx.principal.updateMany({ where: { teamLeaderId: loserId }, data: { teamLeaderId: winnerId } })).count;
    reassigned.employeeMasterRows = (await tx.employeeMaster.updateMany({ where: { teamLeaderId: loserId }, data: { teamLeaderId: winnerId } })).count;

    // User — @unique, so at most one login can ever be linked to each side.
    const loserUser = await tx.user.findFirst({ where: { teamLeaderId: loserId }, select: { id: true, email: true } });
    let userStillOnLoser = false;
    if (loserUser) {
      const winnerUser = await tx.user.findFirst({ where: { teamLeaderId: winnerId }, select: { email: true } });
      if (winnerUser) {
        conflicts.push(`${loserUser.email} and ${winnerUser.email} are both logins linked to this identity — relink one manually on /admin/users.`);
        userStillOnLoser = true;
      } else {
        await tx.user.update({ where: { id: loserUser.id }, data: { teamLeaderId: winnerId } });
        reassigned.loginLinked = 1;
      }
    }

    // Only delete the loser once truly nothing points at it any more —
    // these are plain id-by-convention strings, not real foreign keys, so a
    // row left behind by a conflict above would be silently orphaned rather
    // than block the delete if it weren't checked for here.
    const stillReferenced =
      (await tx.teamLeaderAssignment.count({ where: { teamLeaderId: loserId } })) > 0 ||
      (await tx.performanceTracker.count({ where: { teamLeaderId: loserId } })) > 0 ||
      (await tx.weeklyTarget.count({ where: { teamLeaderId: loserId } })) > 0 ||
      userStillOnLoser;
    if (!stillReferenced) {
      await tx.teamLeader.delete({ where: { id: loserId } });
      loserDeleted = true;
    }
  });

  return { winnerName: winner.name, loserName: loser.name, reassigned, conflicts, loserDeleted };
}

/** Merges `loserId` into `winnerId` — every TeamLeaderAssignment.supervisorId,
 *  TeamLeader.supervisorId, Principal.supervisorId, EmployeeMaster.supervisorId,
 *  and (where unambiguous) User.supervisorId that pointed at `loserId` now
 *  points at `winnerId`; the loser Supervisor row is then deleted. None of
 *  these fields carry a uniqueness constraint involving supervisorId alone,
 *  so (unlike the Team Leader merge above) the only possible conflict is the
 *  login-link case. */
export async function mergeSupervisors(winnerId: string, loserId: string): Promise<MergeResult> {
  if (winnerId === loserId) throw new Error("Choose two different Supervisors to merge.");

  const [winner, loser] = await Promise.all([
    prisma.supervisor.findUnique({ where: { id: winnerId }, select: { name: true } }),
    prisma.supervisor.findUnique({ where: { id: loserId }, select: { name: true } }),
  ]);
  if (!winner || !loser) throw new Error("Supervisor not found.");

  const reassigned: Record<string, number> = {};
  const conflicts: string[] = [];
  let loserDeleted = false;

  await prisma.$transaction(async (tx) => {
    reassigned.teamLeaderAssignments = (await tx.teamLeaderAssignment.updateMany({ where: { supervisorId: loserId }, data: { supervisorId: winnerId } })).count;
    reassigned.teamLeaders = (await tx.teamLeader.updateMany({ where: { supervisorId: loserId }, data: { supervisorId: winnerId } })).count;
    reassigned.principals = (await tx.principal.updateMany({ where: { supervisorId: loserId }, data: { supervisorId: winnerId } })).count;
    reassigned.employeeMasterRows = (await tx.employeeMaster.updateMany({ where: { supervisorId: loserId }, data: { supervisorId: winnerId } })).count;

    const loserUser = await tx.user.findFirst({ where: { supervisorId: loserId }, select: { id: true, email: true } });
    let userStillOnLoser = false;
    if (loserUser) {
      const winnerUser = await tx.user.findFirst({ where: { supervisorId: winnerId }, select: { email: true } });
      if (winnerUser) {
        conflicts.push(`${loserUser.email} and ${winnerUser.email} are both logins linked to this identity — relink one manually on /admin/users.`);
        userStillOnLoser = true;
      } else {
        await tx.user.update({ where: { id: loserUser.id }, data: { supervisorId: winnerId } });
        reassigned.loginLinked = 1;
      }
    }

    if (!userStillOnLoser) {
      await tx.supervisor.delete({ where: { id: loserId } });
      loserDeleted = true;
    }
  });

  return { winnerName: winner.name, loserName: loser.name, reassigned, conflicts, loserDeleted };
}

// Re-exported so callers only need one import for "merge, then recompute" —
// same function admin/team-leaders/actions.ts already uses after any other
// TeamLeaderAssignment-touching change.
export { recomputeRosterDerived } from "./rosterAssignment";

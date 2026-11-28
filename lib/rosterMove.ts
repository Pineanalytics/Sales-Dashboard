// Moving a rep to another home Team Leader from the Employee Roster. A rep's Team Leader lives in three places: EmployeeMaster.teamLeader
// (the name), EmployeeMaster.teamLeaderId/supervisorId (the "home" Team Leader the roster table, Timestamps and scoping read) and the rep's
// TeamLeaderAssignment rows (what targets, contributions and Team Leader views read). Changing only the name left the other two on the old
// Team Leader, so the roster kept showing the original one. A move updates all three, in one transaction, with an audit entry per changed
// assignment, the same way the roster re-alignment scripts do.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface AssignmentRow {
  id: string;
  teamLeaderId: string;
  principal: string;
  active: boolean;
}

export type MoveStep =
  /** Re-point an assignment at the new Team Leader. */
  | { kind: "move"; assignmentId: string; principal: string }
  /** The new Team Leader already has a row for this principal: reactivate it and retire the old one, keeping both histories. */
  | { kind: "reactivate"; keepId: string; retireId: string; principal: string; keepWasActive: boolean }
  /** No assignment came across and the new Team Leader has none for the rep's principal: add one, as adding a rep does. */
  | { kind: "create"; principal: string };

/** What a move does to the rep's assignments: every active assignment held by the old home Team Leader goes to the new one (assignments
 *  held by any other Team Leader are a different relationship and stay). If that leaves the rep with no active assignment under the new Team
 *  Leader for their absolute principal, one is created. Pure, for tests. */
export function planTeamLeaderMove(input: {
  assignments: AssignmentRow[];
  fromTeamLeaderId: string | null;
  toTeamLeaderId: string;
  absolutePrincipal: string;
}): MoveStep[] {
  const { assignments, fromTeamLeaderId, toTeamLeaderId, absolutePrincipal } = input;
  const steps: MoveStep[] = [];
  const targetByPrincipal = new Map(assignments.filter((a) => a.teamLeaderId === toTeamLeaderId).map((a) => [a.principal, a]));
  const activeUnderTarget = new Set(assignments.filter((a) => a.teamLeaderId === toTeamLeaderId && a.active).map((a) => a.principal));

  if (fromTeamLeaderId && fromTeamLeaderId !== toTeamLeaderId) {
    for (const a of assignments) {
      if (a.teamLeaderId !== fromTeamLeaderId || !a.active) continue;
      const existing = targetByPrincipal.get(a.principal);
      if (existing) steps.push({ kind: "reactivate", keepId: existing.id, retireId: a.id, principal: a.principal, keepWasActive: existing.active });
      else steps.push({ kind: "move", assignmentId: a.id, principal: a.principal });
      activeUnderTarget.add(a.principal);
    }
  }
  if (!activeUnderTarget.has(absolutePrincipal)) {
    const existing = targetByPrincipal.get(absolutePrincipal);
    // A retired row for the principal under the new Team Leader comes back rather than being duplicated.
    if (existing) steps.push({ kind: "reactivate", keepId: existing.id, retireId: "", principal: absolutePrincipal, keepWasActive: false });
    else steps.push({ kind: "create", principal: absolutePrincipal });
  }
  return steps;
}

export interface MoveResult {
  fromTeamLeader: string | null;
  toTeamLeader: string;
  /** Assignments moved, reactivated or created. */
  assignmentsChanged: number;
}

/** Makes `toTeamLeaderName` the rep's home Team Leader everywhere (see the file comment). Assumes the editor may do this (admins only). */
export async function moveRepToTeamLeader(input: { employeeCode: string; toTeamLeaderName: string; userEmail: string }): Promise<MoveResult> {
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employeeMaster.findUnique({ where: { employeeCode: input.employeeCode } });
    if (!employee) throw new Error(`Employee ${input.employeeCode} not found.`);
    const target = await tx.teamLeader.findUnique({ where: { name: input.toTeamLeaderName }, select: { id: true, name: true, supervisorId: true } });
    if (!target) throw new Error(`Team Leader "${input.toTeamLeaderName}" not found.`);
    const from =
      (employee.teamLeaderId ? await tx.teamLeader.findUnique({ where: { id: employee.teamLeaderId }, select: { id: true, name: true } }) : null) ??
      (employee.teamLeader ? await tx.teamLeader.findUnique({ where: { name: employee.teamLeader }, select: { id: true, name: true } }) : null);

    const assignments = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: input.employeeCode } });
    const byId = new Map(assignments.map((a) => [a.id, a]));
    const steps = planTeamLeaderMove({ assignments, fromTeamLeaderId: from?.id ?? null, toTeamLeaderId: target.id, absolutePrincipal: employee.absolutePrincipal });

    const audit = (action: string, teamLeaderId: string, principal: string, changes: Prisma.InputJsonValue) =>
      tx.teamLeaderAssignmentAuditLog.create({
        data: { userEmail: input.userEmail, action, teamLeaderId, supervisorId: target.supervisorId, principal, employeeCode: input.employeeCode, changes },
      });
    const reason = `Home Team Leader changed on Employee Roster${from ? ` from ${from.name}` : ""} to ${target.name}`;

    for (const step of steps) {
      if (step.kind === "move") {
        await tx.teamLeaderAssignment.update({ where: { id: step.assignmentId }, data: { teamLeaderId: target.id, supervisorId: target.supervisorId } });
        await audit("UPDATE", target.id, step.principal, { teamLeaderId: { old: byId.get(step.assignmentId)?.teamLeaderId ?? null, new: target.id }, reason: { old: null, new: reason } });
      } else if (step.kind === "reactivate") {
        await tx.teamLeaderAssignment.update({ where: { id: step.keepId }, data: { active: true, supervisorId: target.supervisorId } });
        if (!step.keepWasActive) await audit("REACTIVATE", target.id, step.principal, { active: { old: false, new: true }, reason: { old: null, new: reason } });
        if (step.retireId) {
          const retired = byId.get(step.retireId);
          await tx.teamLeaderAssignment.update({ where: { id: step.retireId }, data: { active: false } });
          await audit("DEACTIVATE", retired?.teamLeaderId ?? target.id, step.principal, { active: { old: true, new: false }, reason: { old: null, new: reason } });
        }
      } else {
        await tx.teamLeaderAssignment.create({
          data: {
            teamLeaderId: target.id,
            employeeCode: employee.employeeCode,
            employeeName: employee.pineName,
            sapName: employee.sapName,
            principal: step.principal,
            absolutePrincipal: employee.absolutePrincipal,
            active: true,
            salesRole: employee.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY",
            supervisorId: target.supervisorId,
          },
        });
        await audit("CREATE", target.id, step.principal, { created: { old: null, new: `${employee.pineName} under ${target.name}` }, reason: { old: null, new: reason } });
      }
    }

    // An authoritative move: overwrite the home Team Leader rather than only filling a blank (lib/employeeIdentity.ts's rule is for inference).
    await tx.employeeMaster.update({
      where: { employeeCode: input.employeeCode },
      data: { teamLeader: target.name, teamLeaderId: target.id, supervisorId: target.supervisorId },
    });
    return { fromTeamLeader: from?.name ?? null, toTeamLeader: target.name, assignmentsChanged: steps.length };
  });
}

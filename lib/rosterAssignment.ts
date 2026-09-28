// Shared core for granting a Team Leader real dashboard visibility into a
// whole Principal — the actual fix for "a Team Leader is assigned to a
// Principal but can't see its data" (see lib/teamLeaderScope.ts's header
// comment: visibility comes exclusively from TeamLeaderAssignment rows,
// never from Principal.teamLeaderId/supervisorId, which are ranking-only).
// Extracted from admin/team-leaders/actions.ts's
// assignPrincipalToTeamLeaderAction so the same logic can also run from a
// bulk Sales Leadership CSV import (lib/salesLeadershipImport.ts) without
// going through a form submission.
import { prisma } from "./db";
import { recomputeRepContribution, recomputeDailyTargets } from "./repContribution";
import { resolveEmployeeIdentities } from "./employeeIdentity";

export interface AssignPrincipalResult {
  added: number;
  reactivated: number;
  alreadyVisible: number;
}

/** Creates/reactivates a TeamLeaderAssignment row for every active rep
 *  currently recognized under `principal` (EmployeePrincipalContribution,
 *  the same source of truth a single-rep addition already validates
 *  against), under `teamLeaderId`. Idempotent — safe to re-run after new
 *  reps are onboarded onto a Principal a Team Leader already owns. Does not
 *  recompute Contribution-by-Rep/Daily Projection itself — call
 *  recomputeRosterDerived once after a batch of these, not per call. */
export async function assignPrincipalRepsToTeamLeader(
  teamLeaderId: string,
  principal: string,
  supervisorId: string | null,
  userEmail: string
): Promise<AssignPrincipalResult> {
  const contributions = await prisma.employeePrincipalContribution.findMany({
    where: { principal, employee: { active: true } },
    select: { employee: { select: { employeeCode: true, pineName: true, sapName: true, salesRole: true } } },
  });

  let added = 0;
  let reactivated = 0;
  let alreadyVisible = 0;
  for (const { employee } of contributions) {
    const salesRole = employee.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY";
    const existing = await prisma.teamLeaderAssignment.findUnique({
      where: { teamLeaderId_employeeCode_principal: { teamLeaderId, employeeCode: employee.employeeCode, principal } },
    });
    if (existing) {
      if (existing.active) {
        alreadyVisible += 1;
        continue;
      }
      await prisma.teamLeaderAssignment.update({
        where: { id: existing.id },
        data: { active: true, employeeName: employee.pineName, sapName: employee.sapName, salesRole, supervisorId },
      });
      await prisma.teamLeaderAssignmentAuditLog.create({
        data: {
          userEmail,
          action: "REACTIVATE",
          teamLeaderId,
          principal,
          employeeCode: employee.employeeCode,
          changes: { active: { old: false, new: true } },
        },
      });
      reactivated += 1;
      continue;
    }
    await prisma.teamLeaderAssignment.create({
      data: {
        teamLeaderId,
        employeeCode: employee.employeeCode,
        employeeName: employee.pineName,
        sapName: employee.sapName,
        principal,
        active: true,
        salesRole,
        supervisorId,
      },
    });
    added += 1;
  }

  return { added, reactivated, alreadyVisible };
}

/** Recomputes Contribution-by-Rep/Daily Projection/Employee identity — call
 *  once after a batch of assignPrincipalRepsToTeamLeader calls, not per call
 *  (each is a full-table pass). */
export async function recomputeRosterDerived(): Promise<void> {
  await recomputeRepContribution();
  await recomputeDailyTargets();
  await resolveEmployeeIdentities();
}

"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownPrincipals, getKnownSapSalesReps } from "@/lib/adminReference";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";
import { resolveEmployeeIdentities } from "@/lib/employeeIdentity";

const PAGE = "/admin/employee-master";

function value(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

function roleForAssignment(salesRole: string): "PRIMARY" | "SECONDARY" {
  return salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY";
}

async function requireRosterEditor() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) redirect("/");
  if (session.user.role === "ADMIN") return { user: session.user, isAdmin: true, teamLeader: null };
  if (!session.user.teamLeaderId) redirect(`${PAGE}?error=${encodeURIComponent("Your account is not linked to a Team Leader roster.")}`);
  const teamLeader = await prisma.teamLeader.findUnique({ where: { id: session.user.teamLeaderId }, select: { id: true, name: true } });
  if (!teamLeader) redirect(`${PAGE}?error=${encodeURIComponent("Your Team Leader roster could not be found.")}`);
  return { user: session.user, isAdmin: false, teamLeader };
}

async function assertCanEditEmployee(editor: Awaited<ReturnType<typeof requireRosterEditor>>, employeeCode: string) {
  if (editor.isAdmin) return;
  const assignment = await prisma.teamLeaderAssignment.findFirst({ where: { teamLeaderId: editor.teamLeader!.id, employeeCode } });
  if (!assignment) redirect(`${PAGE}?error=${encodeURIComponent("You can only update reps assigned to your own roster.")}`);
}

async function recomputeDerived() {
  await recomputeRepContribution();
  await recomputeDailyTargets();
  await resolveEmployeeIdentities();
}

export async function saveEmployeeMasterAction(formData: FormData) {
  const editor = await requireRosterEditor();
  const employeeCode = value(formData, "employeeCode");
  const pineName = value(formData, "pineName");
  const sapName = value(formData, "sapName") || pineName;
  const absolutePrincipal = value(formData, "absolutePrincipal");
  const salesRole = value(formData, "salesRole") || "Primary Sales";
  const teamLeaderName = editor.isAdmin ? value(formData, "teamLeader") : editor.teamLeader!.name;
  const existing = employeeCode ? await prisma.employeeMaster.findUnique({ where: { employeeCode } }) : null;

  if (!employeeCode || !pineName || !absolutePrincipal || !teamLeaderName) {
    redirect(`${PAGE}?error=${encodeURIComponent("Employee code, Pine name, absolute principal, and Team Leader are required.")}`);
  }
  const [knownPrincipals, knownSapNames] = await Promise.all([getKnownPrincipals(), getKnownSapSalesReps()]);
  if (!knownPrincipals.includes(absolutePrincipal)) {
    redirect(`${PAGE}?error=${encodeURIComponent("Choose an available principal from the list.")}`);
  }
  if (!knownSapNames.includes(sapName)) {
    redirect(`${PAGE}?error=${encodeURIComponent("Choose a SAP sales rep name from the live SAP list.")}`);
  }
  if (existing) await assertCanEditEmployee(editor, employeeCode);

  if (existing) {
    await prisma.employeeMaster.update({
      where: { employeeCode },
      data: { pineName, sapName, absolutePrincipal, salesRole, teamLeader: teamLeaderName },
    });
    await recomputeDerived();
    redirect(`${PAGE}?success=${encodeURIComponent(`Updated ${pineName}.`)}`);
  }

  const teamLeader = await prisma.teamLeader.findUnique({ where: { name: teamLeaderName }, select: { id: true, name: true } });
  if (!teamLeader) redirect(`${PAGE}?error=${encodeURIComponent("Choose a valid Team Leader before adding a rep.")}`);

  await prisma.$transaction(async (tx) => {
    const employee = await tx.employeeMaster.create({
      data: {
        employeeCode,
        pineName,
        sapName,
        absolutePrincipal,
        salesRole,
        teamLeader: teamLeader.name,
        contributions: { create: { principal: absolutePrincipal, salesRole, contributionPct: 1 } },
      },
    });
    await tx.teamLeaderAssignment.upsert({
      where: { teamLeaderId_employeeCode_principal: { teamLeaderId: teamLeader.id, employeeCode, principal: absolutePrincipal } },
      create: { teamLeaderId: teamLeader.id, employeeCode, employeeName: employee.pineName, sapName: employee.sapName, principal: absolutePrincipal, active: true, salesRole: roleForAssignment(salesRole), absolutePrincipal },
      update: { employeeName: employee.pineName, sapName: employee.sapName, active: true, salesRole: roleForAssignment(salesRole), absolutePrincipal },
    });
  });
  await recomputeDerived();
  redirect(`${PAGE}?success=${encodeURIComponent(`Added ${pineName} to ${teamLeader.name}'s roster.`)}`);
}

export async function toggleEmployeeMasterActiveAction(formData: FormData) {
  const editor = await requireRosterEditor();
  const employeeCode = value(formData, "employeeCode");
  if (!employeeCode) redirect(`${PAGE}?error=Missing%20employee%20code.`);
  const employee = await prisma.employeeMaster.findUnique({ where: { employeeCode } });
  if (!employee) redirect(`${PAGE}?error=Employee%20not%20found.`);
  await assertCanEditEmployee(editor, employeeCode);

  const active = !employee.active;
  const assignmentWhere = editor.isAdmin ? { employeeCode } : { employeeCode, teamLeaderId: editor.teamLeader!.id };
  await prisma.$transaction([
    prisma.employeeMaster.update({ where: { employeeCode }, data: { active } }),
    prisma.teamLeaderAssignment.updateMany({ where: assignmentWhere, data: { active } }),
  ]);
  await recomputeDerived();
  redirect(`${PAGE}?success=${encodeURIComponent(`${active ? "Activated" : "Deactivated"} ${employee.pineName}.`)}`);
}

/** Admin-only: manually resolves one rep's ambiguous "home" Team Leader from
 *  the worklist (resolveEmployeeIdentities only auto-fills the unambiguous
 *  case; a genuine multi-Team-Leader rep needs a person to pick one). Also
 *  sets the derived supervisorId from that Team Leader's own reporting line.
 *  Admin-only rather than TEAM_LEADER-scoped like the rest of this file —
 *  deciding a rep's canonical identity across multiple Team Leaders is a
 *  cross-Team-Leader call, not "your own roster." */
export async function resolveEmployeeIdentityAction(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const employeeCode = value(formData, "employeeCode");
  const teamLeaderId = value(formData, "teamLeaderId");
  if (!employeeCode || !teamLeaderId) redirect(`${PAGE}?error=${encodeURIComponent("Missing employee or Team Leader.")}`);

  const teamLeader = await prisma.teamLeader.findUnique({ where: { id: teamLeaderId }, select: { id: true, supervisorId: true } });
  if (!teamLeader) redirect(`${PAGE}?error=${encodeURIComponent("Team Leader not found.")}`);

  await prisma.employeeMaster.update({
    where: { employeeCode },
    data: { teamLeaderId: teamLeader.id, supervisorId: teamLeader.supervisorId },
  });
  redirect(`${PAGE}?success=${encodeURIComponent("Identity resolved.")}`);
}

/** Admin-only: permanently removes one roster record — for a stray duplicate
 *  (e.g. a record whose "code" is really a name) or someone who should never
 *  have been added. Its Team Leader assignments go with it, each written to
 *  the assignment audit log as a DELETE like the Team Leaders page's own
 *  Delete; its principal contributions cascade. Refused while a login is
 *  linked to the code (unlink it on Users & access first), so no account is
 *  left pointing at a record that no longer exists. Deactivate is the
 *  reversible alternative. */
export async function deleteEmployeeMasterAction(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const employeeCode = value(formData, "employeeCode");
  if (!employeeCode) redirect(`${PAGE}?error=Missing%20employee%20code.`);

  const [employee, linkedUser, assignments] = await Promise.all([
    prisma.employeeMaster.findUnique({ where: { employeeCode } }),
    prisma.user.findUnique({ where: { employeeCode }, select: { email: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { employeeCode } }),
  ]);
  if (!employee) redirect(`${PAGE}?error=Employee%20not%20found.`);
  if (linkedUser) {
    redirect(`${PAGE}?error=${encodeURIComponent(`${employee.pineName} (${employeeCode}) is linked to the login ${linkedUser.email}. Unlink it on Users & access before deleting.`)}`);
  }

  const supervisorIds = new Map(
    (await prisma.teamLeader.findMany({ where: { id: { in: assignments.map((a) => a.teamLeaderId) } }, select: { id: true, supervisorId: true } })).map((tl) => [tl.id, tl.supervisorId])
  );
  await prisma.$transaction([
    prisma.teamLeaderAssignment.deleteMany({ where: { employeeCode } }),
    prisma.employeeMaster.delete({ where: { employeeCode } }),
    ...assignments.map((a) =>
      prisma.teamLeaderAssignmentAuditLog.create({
        data: {
          userEmail: session.user.email!,
          action: "DELETE",
          teamLeaderId: a.teamLeaderId,
          supervisorId: supervisorIds.get(a.teamLeaderId) ?? null,
          principal: a.principal,
          employeeCode,
          changes: { reason: { old: null, new: "Roster record deleted on Employee Roster" }, active: { old: a.active, new: false } },
        },
      })
    ),
  ]);
  await recomputeDerived();
  const removed = assignments.length > 0 ? ` and ${assignments.length} Team Leader assignment${assignments.length === 1 ? "" : "s"}` : "";
  redirect(`${PAGE}?success=${encodeURIComponent(`Deleted ${employee.pineName} (${employeeCode})${removed}.`)}`);
}

/** Hides one timestamp roster suggestion (a test login, a van code, someone
 *  who has left) until it is restored. Any roster editor can dismiss what
 *  they can see. */
export async function dismissRosterSuggestionAction(formData: FormData) {
  const editor = await requireRosterEditor();
  const employeeCode = value(formData, "employeeCode");
  const salesRep = value(formData, "salesRep") || null;
  if (!employeeCode) redirect(`${PAGE}?error=Missing%20employee%20code.`);
  await prisma.rosterSuggestionDismissal.upsert({
    where: { employeeCode },
    create: { employeeCode, salesRep, dismissedBy: editor.user.email ?? "unknown" },
    update: { salesRep, dismissedBy: editor.user.email ?? "unknown", dismissedAt: new Date() },
  });
  redirect(`${PAGE}?success=${encodeURIComponent(`Dismissed the suggestion for ${salesRep ?? employeeCode}.`)}`);
}

/** Brings a dismissed suggestion back (it shows again while its calls are within the 90-day window). */
export async function restoreRosterSuggestionAction(formData: FormData) {
  await requireRosterEditor();
  const employeeCode = value(formData, "employeeCode");
  if (!employeeCode) redirect(`${PAGE}?error=Missing%20employee%20code.`);
  await prisma.rosterSuggestionDismissal.deleteMany({ where: { employeeCode } });
  redirect(`${PAGE}?success=${encodeURIComponent(`Restored the suggestion for ${employeeCode}.`)}`);
}

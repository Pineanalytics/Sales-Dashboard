"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownPrincipals, getKnownSapSalesReps } from "@/lib/adminReference";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

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

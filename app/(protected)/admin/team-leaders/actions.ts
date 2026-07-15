"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function createTeamLeaderAction(formData: FormData) {
  await requireAdmin();
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader name is required."));
  }

  try {
    await prisma.teamLeader.create({ data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Team Leader named "${name}" already exists.`
        : "Failed to add the Team Leader.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Added Team Leader "${name}".`));
}

export async function renameTeamLeaderAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "teamLeaderId");
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader name is required."));
  }

  try {
    await prisma.teamLeader.update({ where: { id }, data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Team Leader named "${name}" already exists.`
        : "Failed to rename the Team Leader.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Team Leader renamed."));
}

export async function deleteTeamLeaderAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "teamLeaderId");

  const teamLeader = await prisma.teamLeader.findUnique({ where: { id } });
  if (!teamLeader) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader not found."));
  }

  // Cascade the fact-table rows too — an orphaned assignment pointing at a deleted
  // Team Leader would silently disappear from every Weekly Target grid anyway, so
  // there's nothing useful to keep. WeeklyTarget/DailyTarget history for this
  // teamLeaderId is left as-is (an audit/history record, not a live grid row).
  await prisma.teamLeaderAssignment.deleteMany({ where: { teamLeaderId: id } });
  await prisma.teamLeader.delete({ where: { id } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Removed Team Leader "${teamLeader.name}" and their assignments.`));
}

export async function createAssignmentAction(formData: FormData) {
  await requireAdmin();
  const teamLeaderId = str(formData, "teamLeaderId");
  const employeeCode = str(formData, "employeeCode");
  const employeeName = str(formData, "employeeName");
  const principal = str(formData, "principal");

  if (!teamLeaderId || !employeeCode || !principal) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader, Employee Code, and Principal are required."));
  }

  try {
    await prisma.teamLeaderAssignment.create({
      data: { teamLeaderId, employeeCode, employeeName: employeeName || employeeCode, principal },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "That rep is already assigned to this Team Leader for this Principal."
        : "Failed to add the assignment.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Assigned ${employeeName || employeeCode} — ${principal}.`));
}

export async function deleteAssignmentAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "assignmentId");

  await prisma.teamLeaderAssignment.delete({ where: { id } });
  redirect("/admin/team-leaders?success=" + encodeURIComponent("Assignment removed."));
}

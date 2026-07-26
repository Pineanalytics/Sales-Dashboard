"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";
import type { TeamLeaderAssignment } from "@prisma/client";

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

function pct(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null; // form takes a whole-number percent, stored as a fraction
}

// Roster edits (create/update/deactivate) recompute Contribution-by-Rep and Daily Projection
// immediately, rather than waiting for the next JP Adherence sync — an admin changing a declared
// Contribution % or deactivating a rep should see it reflected right away.
async function recomputeDerived() {
  await recomputeRepContribution();
  await recomputeDailyTargets();
}

const ASSIGNMENT_AUDITED_FIELDS = ["channel", "contributionPct", "active", "salesRole"] as const;

async function logAssignmentAudit(
  userEmail: string,
  action: "CREATE" | "UPDATE" | "DEACTIVATE" | "REACTIVATE" | "DELETE",
  assignment: Pick<TeamLeaderAssignment, "teamLeaderId" | "principal" | "employeeCode">,
  before: Partial<Record<(typeof ASSIGNMENT_AUDITED_FIELDS)[number], string | number | boolean | null>>,
  after: Partial<Record<(typeof ASSIGNMENT_AUDITED_FIELDS)[number], string | number | boolean | null>>
) {
  const changes: Record<string, { old: string | number | boolean | null; new: string | number | boolean | null }> = {};
  for (const field of ASSIGNMENT_AUDITED_FIELDS) {
    const oldVal = before[field] ?? null;
    const newVal = after[field] ?? null;
    if (oldVal !== newVal) changes[field] = { old: oldVal, new: newVal };
  }
  if (Object.keys(changes).length === 0 && action === "UPDATE") return;

  await prisma.teamLeaderAssignmentAuditLog.create({
    data: {
      userEmail,
      action,
      teamLeaderId: assignment.teamLeaderId,
      principal: assignment.principal,
      employeeCode: assignment.employeeCode,
      changes,
    },
  });
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
  const user = await requireAdmin();
  const teamLeaderId = str(formData, "teamLeaderId");
  const employeeCode = str(formData, "employeeCode");
  const employeeName = str(formData, "employeeName");
  // A typed "new Principal" wins over the dropdown pick — lets a genuinely new
  // Principal (not yet in Target/JP data) be assigned without blocking on it existing.
  const principal = str(formData, "newPrincipal") || str(formData, "principal");
  const channel = str(formData, "channel") || null;
  const contributionPct = pct(formData, "contributionPct");
  const salesRole = str(formData, "salesRole") || "PRIMARY";

  // Carries the just-used Team Leader + Principal back into the form (see the redirects
  // below) so adding several reps in a row to the same Team Leader × Principal doesn't
  // require reselecting them each time — only Employee Code/Name change per row.
  const carryForward = `&teamLeaderId=${encodeURIComponent(teamLeaderId)}&principal=${encodeURIComponent(principal)}`;

  if (!teamLeaderId || !employeeCode || !principal) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader, Employee Code, and Principal are required.") + carryForward);
  }

  try {
    await prisma.teamLeaderAssignment.create({
      data: { teamLeaderId, employeeCode, employeeName: employeeName || employeeCode, principal, channel, contributionPct, salesRole },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "That rep is already assigned to this Team Leader for this Principal."
        : "Failed to add the assignment.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message) + carryForward);
  }

  await logAssignmentAudit(
    user.email!,
    "CREATE",
    { teamLeaderId, principal, employeeCode },
    { channel: null, contributionPct: null, active: true, salesRole: "PRIMARY" },
    { channel, contributionPct, active: true, salesRole }
  );
  await recomputeDerived();

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Assigned ${employeeName || employeeCode} — ${principal}.`) + carryForward);
}

export async function updateAssignmentAction(formData: FormData) {
  const user = await requireAdmin();
  const id = str(formData, "assignmentId");

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found."));
  }

  const channel = str(formData, "channel") || null;
  const contributionPct = pct(formData, "contributionPct");
  const salesRole = str(formData, "salesRole") || "PRIMARY";

  await prisma.teamLeaderAssignment.update({
    where: { id },
    data: { channel, contributionPct, salesRole },
  });

  await logAssignmentAudit(
    user.email!,
    "UPDATE",
    existing,
    { channel: existing.channel, contributionPct: existing.contributionPct, active: existing.active, salesRole: existing.salesRole },
    { channel, contributionPct, active: existing.active, salesRole }
  );
  await recomputeDerived();

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Updated ${existing.employeeName} — ${existing.principal}.`));
}

// The primary "remove a rep" action — preserves WeeklyTarget/DailyTarget/RepContribution
// history and this row's own audit trail (matches Target_Management_System.xlsm's Active Y/N
// Roster flag). deleteAssignmentAction below (hard delete) stays for genuine mistakes.
export async function deactivateAssignmentAction(formData: FormData) {
  const user = await requireAdmin();
  const id = str(formData, "assignmentId");

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found."));
  }

  const nextActive = !existing.active;
  await prisma.teamLeaderAssignment.update({ where: { id }, data: { active: nextActive } });

  await logAssignmentAudit(
    user.email!,
    nextActive ? "REACTIVATE" : "DEACTIVATE",
    existing,
    { channel: existing.channel, contributionPct: existing.contributionPct, active: existing.active, salesRole: existing.salesRole },
    { channel: existing.channel, contributionPct: existing.contributionPct, active: nextActive, salesRole: existing.salesRole }
  );
  await recomputeDerived();

  redirect(
    "/admin/team-leaders?success=" +
      encodeURIComponent(`${nextActive ? "Reactivated" : "Deactivated"} ${existing.employeeName} — ${existing.principal}.`)
  );
}

export async function deleteAssignmentAction(formData: FormData) {
  const user = await requireAdmin();
  const id = str(formData, "assignmentId");

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found."));
  }

  await prisma.teamLeaderAssignment.delete({ where: { id } });

  await logAssignmentAudit(
    user.email!,
    "DELETE",
    existing,
    { channel: existing.channel, contributionPct: existing.contributionPct, active: existing.active, salesRole: existing.salesRole },
    { channel: null, contributionPct: null, active: false, salesRole: existing.salesRole }
  );
  await recomputeDerived();

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Assignment removed."));
}

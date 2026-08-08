"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";
import { parseRosterCsv, RosterParseError, upsertRosterRows } from "@/lib/rosterImport";
import { resolveScopeForSession, type TeamLeaderScope } from "@/lib/teamLeaderScope";
import type { TeamLeaderAssignment } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

/** A SUPERVISOR gets the same CRUD breadth ADMIN has on this page, restricted to
 *  their own Sales Supervisor group (scope.teamLeaderIds) — every mutating action
 *  below checks the target row's teamLeaderId against this list. scope is null for
 *  an unrestricted ADMIN. Entity-level actions (creating/renaming/deleting a Team
 *  Leader/Supervisor itself, not their rep assignments) stay requireAdmin()-only. */
async function requireAdminOrSupervisor(): Promise<{ user: Awaited<ReturnType<typeof requireAdmin>>; scope: TeamLeaderScope | null }> {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPERVISOR")) {
    redirect("/");
  }
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  return { user: session.user, scope };
}

function assertOwnsTeamLeader(scope: TeamLeaderScope | null, teamLeaderId: string, redirectSuffix = "") {
  if (scope && !scope.teamLeaderIds.includes(teamLeaderId)) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("You can only edit your own Sales Supervisor group's reps.") + redirectSuffix);
  }
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

// Carries the active Team-Leader/Employee filter (see the filter bar on the page) through an
// edit/deactivate/delete round-trip, so acting on a row while filtered doesn't dump the admin
// back into the unfiltered 119-row list.
function filterSuffix(formData: FormData): string {
  const filterTeamLeader = str(formData, "filterTeamLeader");
  const filterEmployee = str(formData, "filterEmployee");
  let suffix = "";
  if (filterTeamLeader) suffix += `&filterTeamLeader=${encodeURIComponent(filterTeamLeader)}`;
  if (filterEmployee) suffix += `&filterEmployee=${encodeURIComponent(filterEmployee)}`;
  return suffix;
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

/** Browser-based alternative to running scripts/target-management/import.ts locally —
 *  accepts a plain CSV export of the Roster sheet (either format, see
 *  lib/rosterImport.ts) and upserts it through the exact same shared logic the
 *  API-key-gated upload route uses. Lets an admin refresh the whole Roster from a
 *  CSV without a local script run. A SUPERVISOR can also use this, but only rows
 *  whose CSV "Sales Supervisor" column matches their own name are kept — everything
 *  else in the file is silently dropped rather than erroring the whole upload, since
 *  a Supervisor's own roster export naturally also lists rows outside their group. */
export async function uploadRosterCsvAction(formData: FormData) {
  const { user, scope } = await requireAdminOrSupervisor();

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Attach a Roster CSV file to upload."));
  }

  let rows, format;
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    ({ rows, format } = parseRosterCsv(buffer));
  } catch (err) {
    const message = err instanceof RosterParseError ? err.message : "Failed to read the uploaded CSV file.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  if (user.role === "SUPERVISOR") {
    const supervisor = scope?.supervisorId ? await prisma.supervisor.findUnique({ where: { id: scope.supervisorId }, select: { name: true } }) : null;
    const ownName = supervisor?.name.trim().toLowerCase();
    const filtered = rows.filter((r) => r.supervisorName?.trim().toLowerCase() === ownName);
    if (filtered.length === 0) {
      redirect(
        "/admin/team-leaders?error=" +
          encodeURIComponent('None of these rows have a "Sales Supervisor" column matching your own name — nothing to import.')
      );
    }
    rows = filtered;
  }

  let result;
  try {
    result = await upsertRosterRows(rows, format);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save the Roster import.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect(
    "/admin/team-leaders?success=" +
      encodeURIComponent(`Imported ${result.assignments} Roster row(s) across ${result.teamLeaders} Team Leader(s).`)
  );
}

export async function createAssignmentAction(formData: FormData) {
  const { user, scope } = await requireAdminOrSupervisor();
  const teamLeaderId = str(formData, "teamLeaderId");
  const employeeCode = str(formData, "employeeCode");
  let employeeName = str(formData, "employeeName");
  // A typed "new Principal" wins over the dropdown pick — lets a genuinely new
  // Principal (not yet in Target/JP data) be assigned without blocking on it existing.
  const principal = str(formData, "newPrincipal") || str(formData, "principal");
  const channel = str(formData, "channel") || null;
  let contributionPct = pct(formData, "contributionPct");
  let salesRole = str(formData, "salesRole") || "PRIMARY";

  // Carries the just-used Team Leader + Principal back into the form (see the redirects
  // below) so adding several reps in a row to the same Team Leader × Principal doesn't
  // require reselecting them each time — only Employee Code/Name change per row.
  const carryForward = `&teamLeaderId=${encodeURIComponent(teamLeaderId)}&principal=${encodeURIComponent(principal)}`;

  if (!teamLeaderId || !employeeCode || !principal) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Team Leader, Employee Code, and Principal are required.") + carryForward);
  }
  assertOwnsTeamLeader(scope, teamLeaderId, carryForward);

  const master = await prisma.employeeMaster.findUnique({
    where: { employeeCode },
    include: { contributions: { where: { principal }, select: { principal: true } } },
  });
  if (master) {
    if (master.contributions.length === 0) {
      redirect(
        "/admin/team-leaders?error=" +
          encodeURIComponent(`${master.pineName} is not assigned to ${principal} in the Employee Roaster Contribution sheet.`) +
          carryForward
      );
    }
    employeeName = master.pineName;
    salesRole = master.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY";
    // Source Contribution is role-normalized; it is not the Team Leader's
    // optional target allocation, so a manual value is left as entered.
    contributionPct = contributionPct ?? null;
  }

  try {
    await prisma.teamLeaderAssignment.create({
      data: {
        teamLeaderId,
        employeeCode,
        employeeName: employeeName || employeeCode,
        sapName: master?.sapName ?? null,
        principal,
        channel,
        contributionPct,
        active: master?.active ?? true,
        salesRole,
      },
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
  const { user, scope } = await requireAdminOrSupervisor();
  const id = str(formData, "assignmentId");
  const suffix = filterSuffix(formData);

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found.") + suffix);
  }
  assertOwnsTeamLeader(scope, existing.teamLeaderId, suffix);

  const channel = str(formData, "channel") || null;
  const contributionPct = pct(formData, "contributionPct");
  let salesRole = str(formData, "salesRole") || "PRIMARY";
  const master = await prisma.employeeMaster.findUnique({ where: { employeeCode: existing.employeeCode }, select: { salesRole: true } });
  if (master) salesRole = master.salesRole === "Primary Sales" ? "PRIMARY" : "SECONDARY";

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

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Updated ${existing.employeeName} — ${existing.principal}.`) + suffix);
}

// The primary "remove a rep" action — preserves WeeklyTarget/DailyTarget/RepContribution
// history and this row's own audit trail (matches Target_Management_System.xlsm's Active Y/N
// Roster flag). deleteAssignmentAction below (hard delete) stays for genuine mistakes.
export async function deactivateAssignmentAction(formData: FormData) {
  const { user, scope } = await requireAdminOrSupervisor();
  const id = str(formData, "assignmentId");
  const suffix = filterSuffix(formData);

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found.") + suffix);
  }
  assertOwnsTeamLeader(scope, existing.teamLeaderId, suffix);

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
      encodeURIComponent(`${nextActive ? "Reactivated" : "Deactivated"} ${existing.employeeName} — ${existing.principal}.`) +
      suffix
  );
}

export async function deleteAssignmentAction(formData: FormData) {
  const { user, scope } = await requireAdminOrSupervisor();
  const id = str(formData, "assignmentId");
  const suffix = filterSuffix(formData);

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Assignment not found.") + suffix);
  }
  assertOwnsTeamLeader(scope, existing.teamLeaderId, suffix);

  await prisma.teamLeaderAssignment.delete({ where: { id } });

  await logAssignmentAudit(
    user.email!,
    "DELETE",
    existing,
    { channel: existing.channel, contributionPct: existing.contributionPct, active: existing.active, salesRole: existing.salesRole },
    { channel: null, contributionPct: null, active: false, salesRole: existing.salesRole }
  );
  await recomputeDerived();

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Assignment removed.") + suffix);
}

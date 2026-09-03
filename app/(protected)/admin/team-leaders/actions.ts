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

// Carries the active hierarchy and roster filters through an edit/deactivate/delete round-trip,
// so acting on a row never drops the administrator back into the full assignment list.
function filterSuffix(formData: FormData): string {
  const filters = [
    "filterTeamLeader",
    "filterPrincipal",
    "filterSupervisor",
    "filterManager",
    "filterEmployee",
  ] as const;
  let suffix = "";
  for (const filter of filters) {
    const value = str(formData, filter);
    if (value) suffix += `&${filter}=${encodeURIComponent(value)}`;
  }
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

/** Sets which Supervisor a Team Leader reports to — TeamLeader.supervisorId, the
 *  reporting line lib/tlRanking.ts's buildSupervisorRanking resolves the TL
 *  Ranking Supervisor rollup from. Replaced resolving this from
 *  TeamLeaderAssignment rows (rep-level, confirmed unreliable when a Team
 *  Leader's own active rows disagreed on managerId/supervisorId). Empty value
 *  clears it (surfaces as "needs a Supervisor" in TL Ranking, not guessed at). */
export async function updateTeamLeaderSupervisorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "teamLeaderId");
  const supervisorId = str(formData, "supervisorId") || null;

  try {
    await prisma.teamLeader.update({ where: { id }, data: { supervisorId } });
  } catch {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Failed to update the Team Leader's Supervisor."));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Reporting line updated."));
}

/** Sets which Manager a Supervisor reports to — Supervisor.managerId, same role
 *  one tier up as TeamLeader.supervisorId above. */
export async function updateSupervisorManagerAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "supervisorId");
  const managerId = str(formData, "managerId") || null;

  try {
    await prisma.supervisor.update({ where: { id }, data: { managerId } });
  } catch {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Failed to update the Supervisor's Manager."));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Reporting line updated."));
}

// Sales Supervisor entity CRUD — mirrors createTeamLeaderAction/
// renameTeamLeaderAction/deleteTeamLeaderAction exactly, one tier up.
// Previously a Supervisor only ever came into existence via a V18 Roster CSV
// upload (upsertRosterRows' find-or-create-by-name); this is the direct
// admin-only equivalent for when there's no CSV to hand, e.g. standing up a
// brand-new Supervisor before any rep roster names them.
export async function createSupervisorAction(formData: FormData) {
  await requireAdmin();
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Supervisor name is required."));
  }

  try {
    await prisma.supervisor.create({ data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Supervisor named "${name}" already exists.`
        : "Failed to add the Supervisor.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Added Supervisor "${name}".`));
}

export async function renameSupervisorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "supervisorId");
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Supervisor name is required."));
  }

  try {
    await prisma.supervisor.update({ where: { id }, data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Supervisor named "${name}" already exists.`
        : "Failed to rename the Supervisor.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Supervisor renamed."));
}

export async function deleteSupervisorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "supervisorId");

  const supervisor = await prisma.supervisor.findUnique({ where: { id } });
  if (!supervisor) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Supervisor not found."));
  }

  // Same reject-deletes-that-orphan-history stance as deleteTeamLeaderAction,
  // one tier up: clear the reporting line on every Team Leader who pointed at
  // this Supervisor rather than leaving a dangling supervisorId, but keep
  // those Team Leaders and their own assignment history intact.
  await prisma.teamLeader.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });
  await prisma.teamLeaderAssignment.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });
  await prisma.supervisor.delete({ where: { id } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Removed Supervisor "${supervisor.name}". Their Team Leaders now need a new Supervisor.`));
}

// Head of Sales (org-entity) CRUD — one tier above Manager, same pattern as
// Supervisor above. Deliberately distinct from the HOD Role a User account can
// hold (Admin -> Users) — see prisma/schema.prisma's Hod model comment for why
// both can name the same real person without either implying the other.
export async function createHodAction(formData: FormData) {
  await requireAdmin();
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Head of Sales name is required."));
  }

  try {
    await prisma.hod.create({ data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Head of Sales named "${name}" already exists.`
        : "Failed to add the Head of Sales.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Added Head of Sales "${name}".`));
}

export async function renameHodAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "hodId");
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Head of Sales name is required."));
  }

  try {
    await prisma.hod.update({ where: { id }, data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Head of Sales named "${name}" already exists.`
        : "Failed to rename the Head of Sales.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Head of Sales renamed."));
}

export async function deleteHodAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "hodId");

  const hod = await prisma.hod.findUnique({ where: { id } });
  if (!hod) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Head of Sales not found."));
  }

  await prisma.manager.updateMany({ where: { hodId: id }, data: { hodId: null } });
  await prisma.hod.delete({ where: { id } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Removed Head of Sales "${hod.name}". Their Managers now need a new Head of Sales.`));
}

/** Sets which Head of Sales a Manager reports to — Manager.hodId. */
export async function updateManagerHodAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "managerId");
  const hodId = str(formData, "hodId") || null;

  try {
    await prisma.manager.update({ where: { id }, data: { hodId } });
  } catch {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Failed to update the Manager's Head of Sales."));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Reporting line updated."));
}

// Director (org-entity) CRUD — one tier above Head of Sales, same pattern.
export async function createDirectorAction(formData: FormData) {
  await requireAdmin();
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Director name is required."));
  }

  try {
    await prisma.director.create({ data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Director named "${name}" already exists.`
        : "Failed to add the Director.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Added Director "${name}".`));
}

export async function renameDirectorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "directorId");
  const name = str(formData, "name");
  if (!name) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Director name is required."));
  }

  try {
    await prisma.director.update({ where: { id }, data: { name } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A Director named "${name}" already exists.`
        : "Failed to rename the Director.";
    redirect("/admin/team-leaders?error=" + encodeURIComponent(message));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Director renamed."));
}

export async function deleteDirectorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "directorId");

  const director = await prisma.director.findUnique({ where: { id } });
  if (!director) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Director not found."));
  }

  await prisma.hod.updateMany({ where: { directorId: id }, data: { directorId: null } });
  await prisma.director.delete({ where: { id } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`Removed Director "${director.name}". Their Heads of Sales now need a new Director.`));
}

/** Sets which Director a Head of Sales reports to — Hod.directorId. */
export async function updateHodDirectorAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "hodId");
  const directorId = str(formData, "directorId") || null;

  try {
    await prisma.hod.update({ where: { id }, data: { directorId } });
  } catch {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Failed to update the Head of Sales' Director."));
  }

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Reporting line updated."));
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
      encodeURIComponent(
        `Imported ${result.assignments} Roster row(s) across ${result.teamLeaders} Team Leader(s). ${result.reportingLineUpdates} reporting-line link(s), ${result.principalOwnershipUpdates} Principal ownership link(s), and ${result.employeeMasterUpserts} Employee Master row(s) refreshed.`
      )
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

/** "Benson relieves Calvince" / "holding fort" — a peer Team Leader granted
 *  temporary access to another Team Leader's own scope. A SUPERVISOR may
 *  only set this up within their own group (both sides checked against
 *  scope.teamLeaderIds) — same breadth as every other action on this page. */
export async function createReliefAction(formData: FormData) {
  const { user, scope } = await requireAdminOrSupervisor();
  const coveringTeamLeaderId = str(formData, "coveringTeamLeaderId");
  const coveredTeamLeaderId = str(formData, "coveredTeamLeaderId");
  const startDateRaw = str(formData, "startDate");
  const endDateRaw = str(formData, "endDate");
  const notes = str(formData, "notes") || null;

  if (!coveringTeamLeaderId || !coveredTeamLeaderId) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Both the covering and covered Team Leader are required."));
  }
  if (coveringTeamLeaderId === coveredTeamLeaderId) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("A Team Leader can't relieve themselves."));
  }
  assertOwnsTeamLeader(scope, coveringTeamLeaderId);
  assertOwnsTeamLeader(scope, coveredTeamLeaderId);

  const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  if (endDate && endDate < startDate) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("End date can't be before the start date."));
  }

  const [covering, covered] = await Promise.all([
    prisma.teamLeader.findUnique({ where: { id: coveringTeamLeaderId }, select: { name: true } }),
    prisma.teamLeader.findUnique({ where: { id: coveredTeamLeaderId }, select: { name: true } }),
  ]);
  if (!covering || !covered) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Unknown Team Leader."));
  }

  await prisma.teamLeaderRelief.create({
    data: { coveringTeamLeaderId, coveredTeamLeaderId, startDate, endDate, notes, createdByUserId: user.id },
  });

  redirect("/admin/team-leaders?success=" + encodeURIComponent(`${covering.name} is now covering ${covered.name}.`));
}

/** Ends a relief immediately (revokedAt), independent of any planned endDate —
 *  the everyday "they're back" action. History is kept, not deleted. */
export async function endReliefAction(formData: FormData) {
  const { scope } = await requireAdminOrSupervisor();
  const id = str(formData, "reliefId");

  const existing = await prisma.teamLeaderRelief.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Relief assignment not found."));
  }
  assertOwnsTeamLeader(scope, existing.coveringTeamLeaderId);
  assertOwnsTeamLeader(scope, existing.coveredTeamLeaderId);

  await prisma.teamLeaderRelief.update({ where: { id }, data: { revokedAt: new Date() } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Relief ended."));
}

/** Removes a relief record entirely — for correcting a mistaken entry, not the
 *  everyday "relief is over" action (use endReliefAction for that; it keeps
 *  history). */
export async function deleteReliefAction(formData: FormData) {
  const { scope } = await requireAdminOrSupervisor();
  const id = str(formData, "reliefId");

  const existing = await prisma.teamLeaderRelief.findUnique({ where: { id } });
  if (!existing) {
    redirect("/admin/team-leaders?error=" + encodeURIComponent("Relief assignment not found."));
  }
  assertOwnsTeamLeader(scope, existing.coveringTeamLeaderId);
  assertOwnsTeamLeader(scope, existing.coveredTeamLeaderId);

  await prisma.teamLeaderRelief.delete({ where: { id } });

  redirect("/admin/team-leaders?success=" + encodeURIComponent("Relief assignment removed."));
}

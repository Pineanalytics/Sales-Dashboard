"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizeAllowedPages } from "@/lib/pageAccess";
import { ROLE_DEFAULT_PAGES, ROLE_LABELS, isRole, roleUsesSupervisorLink, roleUsesTeamLeaderLink, type Role } from "@/lib/roles";
import { sendApprovalEmail, sendAnnouncementEmail, ANNOUNCEMENT_TEMPLATE_KEY, DEFAULT_ANNOUNCEMENT_SUBJECT, DEFAULT_ANNOUNCEMENT_BODY } from "@/lib/email";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

// A native <details> doesn't survive a server action's redirect here (verified: the
// whole list subtree re-renders from a fresh server payload, with no `open` attribute
// carried over) — every redirect that edits an existing, already-approved user's row
// echoes that user's id back via ?open=, which UserDirectory.tsx uses to re-expand
// exactly that row (and only that row), so an admin can make several edits to the same
// user — role, then pages, then principals — without re-finding them in the list after
// every save.
function openSuffix(userId?: string): string {
  return userId ? `&open=${encodeURIComponent(userId)}` : "";
}

async function assertNotLastAdminDemotion(userId: string, currentUser: { id: string }) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect("/admin/users?error=" + encodeURIComponent("User not found."));
  }
  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      redirect(
        "/admin/users?error=" +
          encodeURIComponent(
            userId === currentUser.id ? "You can't demote yourself as the last remaining administrator." : "Can't demote the last remaining administrator."
          ) +
          openSuffix(userId)
      );
    }
  }
}

function readRole(formData: FormData): Role {
  const raw = formData.get("role");
  return isRole(raw) ? raw : "VIEWER";
}

/** Which of the user's unique links a P2002 (unique constraint) error was about, for a message that says which one clashed. */
function uniqueConflictMessage(err: unknown): string | null {
  if (typeof err !== "object" || err === null || (err as { code?: string }).code !== "P2002") return null;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  if (fields.includes("email")) return "A user with that email already exists.";
  if (fields.includes("teamLeaderId")) return "That Team Leader is already linked to another login.";
  if (fields.includes("supervisorId")) return "That Sales Supervisor is already linked to another login.";
  if (fields.includes("employeeCode")) return "That Employee Code is already linked to another login.";
  return "That Team Leader, Sales Supervisor or Employee Code is already linked to another login.";
}

// Optional, role-independent link to EmployeeMaster.employeeCode (the business
// code, not EmployeeMaster.id) — unlocks the personal "My Sales" module. Blank
// clears the link; a non-blank code must resolve to a real roster entry, same
// "pick something real" rule as readTeamLeaderId/readSupervisorId below.
async function readEmployeeCode(formData: FormData, userId?: string): Promise<string | null> {
  const code = String(formData.get("employeeCode") || "").trim();
  if (!code) return null;
  const match = await prisma.employeeMaster.findUnique({ where: { employeeCode: code }, select: { employeeCode: true } });
  if (!match) {
    redirect("/admin/users?error=" + encodeURIComponent(`No roster entry found for Employee Code "${code}".`) + openSuffix(userId));
  }
  return code;
}

// TEAM_LEADER logins need a linked TeamLeader row (User.teamLeaderId, unique) so
// /weekly-targets can scope their reads/writes to just their own team. Any other
// role clears the link, freeing that TeamLeader row up for someone else later.
function readTeamLeaderId(formData: FormData, role: Role, userId?: string): string | null {
  if (!roleUsesTeamLeaderLink(role)) return null;
  const id = String(formData.get("teamLeaderId") || "").trim();
  if (!id) {
    redirect("/admin/users?error=" + encodeURIComponent("Pick a Team Leader to link this login to.") + openSuffix(userId));
  }
  return id;
}

// SUPERVISOR logins need a linked Supervisor row (User.supervisorId, unique) —
// mirrors readTeamLeaderId exactly. See lib/teamLeaderScope.ts's loadSupervisorScope.
function readSupervisorId(formData: FormData, role: Role, userId?: string): string | null {
  if (!roleUsesSupervisorLink(role)) return null;
  const id = String(formData.get("supervisorId") || "").trim();
  if (!id) {
    redirect("/admin/users?error=" + encodeURIComponent("Pick a Sales Supervisor to link this login to.") + openSuffix(userId));
  }
  return id;
}

export async function createUserAction(formData: FormData) {
  await requireAdmin();

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const role = readRole(formData);
  const teamLeaderId = readTeamLeaderId(formData, role);
  const supervisorId = readSupervisorId(formData, role);
  const employeeCode = await readEmployeeCode(formData);

  if (!email || !password || password.length < 8) {
    redirect("/admin/users?error=" + encodeURIComponent("Email is required and password must be at least 8 characters."));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let created;
  try {
    created = await prisma.user.create({
      data: { email, name: name || null, passwordHash, role, teamLeaderId, supervisorId, employeeCode, status: "APPROVED", allowedPages: [...ROLE_DEFAULT_PAGES[role]] },
    });
  } catch (err: unknown) {
    redirect("/admin/users?error=" + encodeURIComponent(uniqueConflictMessage(err) ?? "Failed to create the user."));
  }

  redirect("/admin/users?success=" + encodeURIComponent(`Created ${ROLE_LABELS[role]} account for ${email} with the role's default reports — adjust them below.`) + openSuffix(created.id));
}

// Shared by approveUserAction and approveRoleConfirmationAction: the same
// email-match auto-link /admin/users' own dropdowns suggest (see
// TeamLeader.email/Supervisor.email) so applying a TEAM_LEADER/SUPERVISOR
// role doesn't leave an already-rostered person unlinked for no reason.
async function matchRosterLinkByEmail(role: Role, email: string): Promise<{ teamLeaderId: string | null; supervisorId: string | null }> {
  if (role === "TEAM_LEADER") {
    const match = await prisma.teamLeader.findUnique({ where: { email } });
    return { teamLeaderId: match?.id ?? null, supervisorId: null };
  }
  if (role === "SUPERVISOR") {
    const match = await prisma.supervisor.findUnique({ where: { email } });
    return { teamLeaderId: null, supervisorId: match?.id ?? null };
  }
  return { teamLeaderId: null, supervisorId: null };
}

// On approve, the role the person requested on /register becomes their real
// role (pre-dating role requests means requestedRole is null, so they stay
// VIEWER — the old default). A roster match already claimed by another
// login (P2002) just leaves the link unset rather than blocking the
// approval — the admin can set it by hand afterward, same as any other
// unmatched case.
export async function approveUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect("/admin/users?error=" + encodeURIComponent("Registration request not found."));
  }

  const role = target.requestedRole ?? "VIEWER";
  const { teamLeaderId, supervisorId } = await matchRosterLinkByEmail(role, target.email);

  const allowedPages = [...ROLE_DEFAULT_PAGES[role]];
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { status: "APPROVED", allowedPages, role, teamLeaderId, supervisorId },
    });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
    if (code !== "P2002") throw err;
    await prisma.user.update({
      where: { id: userId },
      data: { status: "APPROVED", allowedPages, role, teamLeaderId: null, supervisorId: null },
    });
  }

  const linked = teamLeaderId || supervisorId ? ` and linked to their matching roster entry by email` : "";
  const emailResult = await sendApprovalEmail(target.email, target.name);
  const message = emailResult.sent
    ? `Approved ${target.email} as ${ROLE_LABELS[role]}${linked}. Notification email sent.`
    : `Approved ${target.email} as ${ROLE_LABELS[role]}${linked}. Notification email NOT sent (${emailResult.error}).`;
  redirect("/admin/users?success=" + encodeURIComponent(message) + openSuffix(userId));
}

export async function rejectUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect("/admin/users?error=" + encodeURIComponent("Registration request not found."));
  }

  await prisma.user.delete({ where: { id: userId } });
  redirect("/admin/users?success=" + encodeURIComponent(`Rejected the request from ${target!.email}.`));
}

// Applies a role someone already APPROVED self-confirmed on the blocking
// /(protected) prompt (User.proposedRole — see that layout and
// app/(protected)/role-confirmation/actions.ts). Same roster auto-link
// attempt as approveUserAction, and the same "last admin" guard
// updateUserRoleAction uses, since this can change role just as that does
// (though proposedRole itself is never ADMIN by construction).
export async function approveRoleConfirmationAction(formData: FormData) {
  const currentUser = await requireAdmin();
  const userId = String(formData.get("userId") || "");

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || !target.proposedRole) {
    redirect("/admin/users?error=" + encodeURIComponent("Role confirmation not found.") + openSuffix(userId));
  }

  const role = target.proposedRole;
  await assertNotLastAdminDemotion(userId, currentUser);
  const { teamLeaderId, supervisorId } = await matchRosterLinkByEmail(role, target.email);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { role, teamLeaderId, supervisorId, proposedRole: null },
    });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
    if (code !== "P2002") throw err;
    await prisma.user.update({ where: { id: userId }, data: { role, proposedRole: null } });
  }

  redirect("/admin/users?success=" + encodeURIComponent(`${target.email} confirmed as ${ROLE_LABELS[role]}.`) + openSuffix(userId));
}

// Keeps the person's role as-is — the confirmation was reviewed but not
// applied (e.g. they picked the wrong thing, or the admin wants to set a
// different role manually via "Save role" instead). Never deletes the
// account; only clears the pending request.
export async function dismissRoleConfirmationAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");

  const target = await prisma.user.update({ where: { id: userId }, data: { proposedRole: null } });
  redirect("/admin/users?success=" + encodeURIComponent(`Dismissed the role confirmation from ${target.email}; their role is unchanged.`) + openSuffix(userId));
}

/** Saves one user's whole profile at once: role, the Team Leader / Sales Supervisor link (kept only for the role it belongs
 *  to), the Employee Code link (any role — unlocks My Sales), the reports they see and the principals they're limited to.
 *  The report and principal pickers are only on the form for the roles they apply to (an admin sees everything; principal
 *  limits only narrow principal-scoped roles, lib/roles.ts), so a picker that wasn't submitted leaves the stored list as it is. */
export async function updateUserAccessAction(formData: FormData) {
  const currentUser = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const role = readRole(formData);
  const teamLeaderId = readTeamLeaderId(formData, role, userId);
  const supervisorId = readSupervisorId(formData, role, userId);
  const employeeCode = await readEmployeeCode(formData, userId);
  if (role !== "ADMIN") await assertNotLastAdminDemotion(userId, currentUser);

  const pagesSubmitted = formData.get("pagesSubmitted") === "1";
  const principalsSubmitted = formData.get("principalsSubmitted") === "1";
  const allowedPages = normalizeAllowedPages(formData.getAll("pages").map(String));
  const allowedPrincipals = formData.getAll("principals").map(String).filter((p) => p.trim().length > 0);

  let target;
  try {
    target = await prisma.user.update({
      where: { id: userId },
      data: {
        role,
        teamLeaderId,
        supervisorId,
        employeeCode,
        ...(pagesSubmitted ? { allowedPages } : {}),
        ...(principalsSubmitted ? { allowedPrincipals } : {}),
      },
    });
  } catch (err: unknown) {
    redirect("/admin/users?error=" + encodeURIComponent(uniqueConflictMessage(err) ?? "Failed to save the user.") + openSuffix(userId));
  }

  const parts = [ROLE_LABELS[role]];
  if (pagesSubmitted) parts.push(`${allowedPages.length} report${allowedPages.length === 1 ? "" : "s"}`);
  if (principalsSubmitted) parts.push(allowedPrincipals.length === 0 ? "every principal" : `${allowedPrincipals.length} principal${allowedPrincipals.length === 1 ? "" : "s"}`);
  if (employeeCode) parts.push(`My Sales for ${employeeCode}`);
  redirect("/admin/users?success=" + encodeURIComponent(`Saved ${target.email}: ${parts.join(" · ")}.`) + openSuffix(userId));
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const newPassword = String(formData.get("newPassword") || "");

  if (!newPassword || newPassword.length < 8) {
    redirect("/admin/users?error=" + encodeURIComponent("New password must be at least 8 characters.") + openSuffix(userId));
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const target = await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  redirect("/admin/users?success=" + encodeURIComponent(`Password reset for ${target.email}.`) + openSuffix(userId));
}

function readAnnouncementFields(formData: FormData): { subject: string; body: string } {
  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  if (!subject || !body) {
    redirect("/admin/users?error=" + encodeURIComponent("Subject and body are both required."));
  }
  return { subject, body };
}

export async function saveAnnouncementTemplateAction(formData: FormData) {
  await requireAdmin();
  const { subject, body } = readAnnouncementFields(formData);

  await prisma.emailTemplate.upsert({
    where: { key: ANNOUNCEMENT_TEMPLATE_KEY },
    update: { subject, body },
    create: { key: ANNOUNCEMENT_TEMPLATE_KEY, subject, body },
  });
  redirect("/admin/users?success=" + encodeURIComponent("Saved the announcement email wording."));
}

export async function resetAnnouncementTemplateAction() {
  await requireAdmin();
  await prisma.emailTemplate.deleteMany({ where: { key: ANNOUNCEMENT_TEMPLATE_KEY } });
  redirect("/admin/users?success=" + encodeURIComponent("Reset the announcement email to its original wording."));
}

export async function sendNewModulesAnnouncementAction(formData: FormData) {
  await requireAdmin();
  const subject = String(formData.get("subject") || "").trim() || DEFAULT_ANNOUNCEMENT_SUBJECT;
  const body = String(formData.get("body") || "").trim() || DEFAULT_ANNOUNCEMENT_BODY;

  // Sending always saves first — whatever you send is what "Save changes" would have saved.
  await prisma.emailTemplate.upsert({
    where: { key: ANNOUNCEMENT_TEMPLATE_KEY },
    update: { subject, body },
    create: { key: ANNOUNCEMENT_TEMPLATE_KEY, subject, body },
  });

  const users = await prisma.user.findMany({ where: { status: "APPROVED" }, select: { email: true, name: true } });
  const results = await Promise.all(users.map((u) => sendAnnouncementEmail(u.email, u.name, subject, body)));
  const sent = results.filter((r) => r.sent).length;
  const failed = results.length - sent;

  if (failed === 0) {
    redirect("/admin/users?success=" + encodeURIComponent(`Sent the announcement to all ${sent} approved user(s).`));
  }
  redirect("/admin/users?error=" + encodeURIComponent(`Sent to ${sent} user(s); ${failed} failed — check SMTP configuration.`));
}

export async function deleteUserAction(formData: FormData) {
  const currentUser = await requireAdmin();
  const userId = String(formData.get("userId") || "");

  if (userId === currentUser.id) {
    redirect("/admin/users?error=" + encodeURIComponent("You can't delete your own account."));
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect("/admin/users?error=" + encodeURIComponent("User not found."));
  }

  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      redirect("/admin/users?error=" + encodeURIComponent("Can't delete the last remaining administrator."));
    }
  }

  await prisma.user.delete({ where: { id: userId } });
  redirect("/admin/users?success=" + encodeURIComponent(`Removed ${target.email}.`));
}

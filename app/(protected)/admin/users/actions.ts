"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALL_PAGE_KEYS, isPageKey } from "@/lib/pageAccess";
import { sendApprovalEmail, sendAnnouncementEmail, ANNOUNCEMENT_TEMPLATE_KEY, DEFAULT_ANNOUNCEMENT_SUBJECT, DEFAULT_ANNOUNCEMENT_BODY } from "@/lib/email";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
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
          )
      );
    }
  }
}

function readRole(formData: FormData): "ADMIN" | "VIEWER" | "TEAM_LEADER" {
  const raw = formData.get("role");
  if (raw === "ADMIN" || raw === "TEAM_LEADER") return raw;
  return "VIEWER";
}

// TEAM_LEADER logins need a linked TeamLeader row (User.teamLeaderId, unique) so
// /weekly-targets can scope their reads/writes to just their own team. Any other
// role clears the link, freeing that TeamLeader row up for someone else later.
function readTeamLeaderId(formData: FormData, role: "ADMIN" | "VIEWER" | "TEAM_LEADER"): string | null {
  if (role !== "TEAM_LEADER") return null;
  const id = String(formData.get("teamLeaderId") || "").trim();
  if (!id) {
    redirect("/admin/users?error=" + encodeURIComponent("Pick a Team Leader to link this login to."));
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

  if (!email || !password || password.length < 8) {
    redirect("/admin/users?error=" + encodeURIComponent("Email is required and password must be at least 8 characters."));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, name: name || null, passwordHash, role, teamLeaderId, status: "APPROVED", allowedPages: [...ALL_PAGE_KEYS] },
    });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
    const message =
      code === "P2002"
        ? teamLeaderId
          ? "That Team Leader is already linked to another login."
          : "A user with that email already exists."
        : "Failed to create the user.";
    redirect("/admin/users?error=" + encodeURIComponent(message));
  }

  redirect("/admin/users?success=" + encodeURIComponent(`Created ${role.toLowerCase()} account for ${email}.`));
}

export async function approveUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    redirect("/admin/users?error=" + encodeURIComponent("Registration request not found."));
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: "APPROVED", allowedPages: [...ALL_PAGE_KEYS] },
  });

  const emailResult = await sendApprovalEmail(target.email, target.name);
  const message = emailResult.sent
    ? `Approved ${target.email} with access to all reports. Notification email sent.`
    : `Approved ${target.email} with access to all reports. Notification email NOT sent (${emailResult.error}).`;
  redirect("/admin/users?success=" + encodeURIComponent(message));
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

export async function updateUserRoleAction(formData: FormData) {
  const currentUser = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const role = readRole(formData);
  const teamLeaderId = readTeamLeaderId(formData, role);

  if (role !== "ADMIN") {
    await assertNotLastAdminDemotion(userId, currentUser);
  }

  let target;
  try {
    target = await prisma.user.update({ where: { id: userId }, data: { role, teamLeaderId } });
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: string }).code : undefined;
    redirect(
      "/admin/users?error=" +
        encodeURIComponent(code === "P2002" ? "That Team Leader is already linked to another login." : "Failed to update the role.")
    );
  }

  const roleLabel = role === "ADMIN" ? "an administrator" : role === "TEAM_LEADER" ? "a team leader" : "a viewer";
  redirect("/admin/users?success=" + encodeURIComponent(`${target.email} is now ${roleLabel}.`));
}

export async function updateUserPagesAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const pages = formData.getAll("pages").map(String).filter(isPageKey);

  const target = await prisma.user.update({ where: { id: userId }, data: { allowedPages: pages } });
  redirect("/admin/users?success=" + encodeURIComponent(`Updated report access for ${target.email}.`));
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const newPassword = String(formData.get("newPassword") || "");

  if (!newPassword || newPassword.length < 8) {
    redirect("/admin/users?error=" + encodeURIComponent("New password must be at least 8 characters."));
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const target = await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  redirect("/admin/users?success=" + encodeURIComponent(`Password reset for ${target.email}.`));
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

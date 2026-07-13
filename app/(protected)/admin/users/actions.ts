"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALL_PAGE_KEYS, isPageKey } from "@/lib/pageAccess";
import { sendApprovalEmail } from "@/lib/email";

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

export async function createUserAction(formData: FormData) {
  await requireAdmin();

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "VIEWER";

  if (!email || !password || password.length < 8) {
    redirect("/admin/users?error=" + encodeURIComponent("Email is required and password must be at least 8 characters."));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, name: name || null, passwordHash, role, status: "APPROVED", allowedPages: [...ALL_PAGE_KEYS] },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A user with that email already exists."
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
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "VIEWER";

  if (role === "VIEWER") {
    await assertNotLastAdminDemotion(userId, currentUser);
  }

  const target = await prisma.user.update({ where: { id: userId }, data: { role } });
  redirect("/admin/users?success=" + encodeURIComponent(`${target.email} is now ${role === "ADMIN" ? "an administrator" : "a viewer"}.`));
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

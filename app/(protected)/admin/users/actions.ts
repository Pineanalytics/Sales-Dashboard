"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
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
      data: { email, name: name || null, passwordHash, role },
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

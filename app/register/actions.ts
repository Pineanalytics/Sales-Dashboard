"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const ALLOWED_EMAIL_DOMAIN = "@pinefrost.co.ke";

// Self-registration deliberately excludes ADMIN — that role is granted by an
// existing admin via /admin/users, never requested at signup.
type RequestableRole = "VIEWER" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR";
const REQUESTABLE_ROLES: RequestableRole[] = ["VIEWER", "TEAM_LEADER", "SUPERVISOR", "HOD", "DIRECTOR"];

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const requestedRoleRaw = String(formData.get("requestedRole") || "");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!name) {
    redirect("/register?error=" + encodeURIComponent("Your full name is required."));
  }
  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    redirect("/register?error=" + encodeURIComponent(`Registration is limited to ${ALLOWED_EMAIL_DOMAIN} email addresses.`));
  }
  if (!REQUESTABLE_ROLES.includes(requestedRoleRaw as RequestableRole)) {
    redirect("/register?error=" + encodeURIComponent("Select the role that best describes you."));
  }
  const requestedRole = requestedRoleRaw as RequestableRole;
  if (!password || password.length < 8) {
    redirect("/register?error=" + encodeURIComponent("Password must be at least 8 characters."));
  }
  if (password !== confirmPassword) {
    redirect("/register?error=" + encodeURIComponent("Passwords don't match."));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, name, passwordHash, role: "VIEWER", requestedRole, status: "PENDING", allowedPages: [] },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A registration or account with that email already exists."
        : "Failed to submit the registration request.";
    redirect("/register?error=" + encodeURIComponent(message));
  }

  redirect("/register?success=1");
}

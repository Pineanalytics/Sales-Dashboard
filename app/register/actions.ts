"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const ALLOWED_EMAIL_DOMAIN = "@pinefrost.co.ke";

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    redirect("/register?error=" + encodeURIComponent(`Registration is limited to ${ALLOWED_EMAIL_DOMAIN} email addresses.`));
  }
  if (!password || password.length < 8) {
    redirect("/register?error=" + encodeURIComponent("Password must be at least 8 characters."));
  }
  if (password !== confirmPassword) {
    redirect("/register?error=" + encodeURIComponent("Passwords don't match."));
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, name: name || null, passwordHash, role: "VIEWER", status: "PENDING", allowedPages: [] },
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

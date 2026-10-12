"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Mirrors registerAction's REQUESTABLE_ROLES — self-service never includes
// ADMIN, whether at signup (requestedRole) or here (proposedRole). Either
// is only ever a request the admin decides on, but excluding ADMIN keeps
// the picker itself from ever suggesting it's an option to self-select.
type ConfirmableRole = "VIEWER" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR";
const CONFIRMABLE_ROLES: ConfirmableRole[] = ["VIEWER", "TEAM_LEADER", "SUPERVISOR", "HOD", "DIRECTOR"];

export async function submitRoleConfirmationAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const roleRaw = String(formData.get("role") || "");
  if (!CONFIRMABLE_ROLES.includes(roleRaw as ConfirmableRole)) {
    redirect("/?roleConfirmationError=" + encodeURIComponent("Select the role that best describes you."));
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { proposedRole: roleRaw as ConfirmableRole, roleConfirmedAt: new Date() },
  });

  redirect("/");
}

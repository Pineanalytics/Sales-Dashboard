"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const REDIRECT_BASE = "/financials?tab=sales-performance";

/** ADMIN-only — the company-wide GP margin commitment has no other owner,
 *  unlike Monthly Target which a Team Leader/Supervisor can be granted
 *  canEditTargets for; this is a single company-wide settings row, not a
 *  per-principal/per-scope figure. */
export async function updateFinanceSettingsAction(formData: FormData) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect(`${REDIRECT_BASE}&error=` + encodeURIComponent("Only an admin can edit the GP margin target."));
  }

  const raw = String(formData.get("grossMarginTargetPct") || "").trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0 || value > 100) {
    redirect(`${REDIRECT_BASE}&error=` + encodeURIComponent("Enter a GP margin target between 0 and 100."));
  }

  await prisma.financeSettings.upsert({
    where: { id: 1 },
    create: { id: 1, grossMarginTargetPct: value, updatedBy: session!.user.email ?? null },
    update: { grossMarginTargetPct: value, updatedBy: session!.user.email ?? null },
  });

  redirect(`${REDIRECT_BASE}&success=` + encodeURIComponent(`GP margin target updated to ${value}%.`));
}

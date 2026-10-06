"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_GP_MARGIN_TARGETS, GP_MARGIN_DEFAULT_KEY } from "@/lib/financePresentation";
import { normalizePrincipalKey } from "@/lib/normalize";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  return session.user;
}

const MAX_PCT = 100;

/** Saves every margin target on the form. A value equal to the policy default is not stored (the
 *  brand just falls back to the default); anything else is saved. Percentages must be 0-100. */
export async function saveGpMarginTargetsAction(formData: FormData) {
  const user = await requireAdmin();
  const updates: { brandKey: string; label: string; targetPct: number }[] = [];
  const problems: string[] = [];

  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("pct:")) continue;
    const brandKey = name.slice(4);
    const label = String(formData.get(`label:${brandKey}`) ?? brandKey);
    const text = String(raw).trim();
    if (text === "") continue; // left blank: keep what is in force
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value > MAX_PCT) {
      problems.push(`${label}: enter a percentage from 0 to ${MAX_PCT}.`);
      continue;
    }
    updates.push({ brandKey: brandKey === GP_MARGIN_DEFAULT_KEY ? brandKey : normalizePrincipalKey(brandKey), label, targetPct: Math.round(value * 100) / 100 });
  }
  if (problems.length > 0) redirect("/admin/gp-targets?error=" + encodeURIComponent(problems.join(" ")));

  let saved = 0;
  let cleared = 0;
  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const policy = update.brandKey === GP_MARGIN_DEFAULT_KEY ? DEFAULT_GP_MARGIN_TARGETS.defaultPct : (DEFAULT_GP_MARGIN_TARGETS.byBrand[update.brandKey] ?? DEFAULT_GP_MARGIN_TARGETS.defaultPct);
      if (update.targetPct === policy) {
        const removed = await tx.gpMarginTarget.deleteMany({ where: { brandKey: update.brandKey } });
        cleared += removed.count;
        continue;
      }
      const existing = await tx.gpMarginTarget.findUnique({ where: { brandKey: update.brandKey }, select: { targetPct: true } });
      if (existing?.targetPct === update.targetPct) continue; // unchanged
      await tx.gpMarginTarget.upsert({
        where: { brandKey: update.brandKey },
        create: { brandKey: update.brandKey, label: update.label, targetPct: update.targetPct, updatedBy: user.email ?? null },
        update: { label: update.label, targetPct: update.targetPct, updatedBy: user.email ?? null },
      });
      saved += 1;
    }
  });

  const message = saved === 0 && cleared === 0 ? "No changes to save." : `Saved ${saved} target${saved === 1 ? "" : "s"}${cleared > 0 ? `; ${cleared} returned to the default` : ""}. The Finance views use them now.`;
  redirect("/admin/gp-targets?success=" + encodeURIComponent(message));
}

/** Drops every saved target so all brands return to the policy defaults. */
export async function resetGpMarginTargetsAction() {
  await requireAdmin();
  const removed = await prisma.gpMarginTarget.deleteMany({});
  redirect("/admin/gp-targets?success=" + encodeURIComponent(removed.count > 0 ? `Reset ${removed.count} target${removed.count === 1 ? "" : "s"} to the policy defaults.` : "Targets are already at the policy defaults."));
}

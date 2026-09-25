"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

function num(formData: FormData, name: string): number | null {
  const raw = str(formData, name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function upsertTargetAction(formData: FormData) {
  await requireAdmin();

  const month = str(formData, "month"); // "YYYY-MM" from <input type="month">
  const distributor = str(formData, "distributor");
  const pjp = str(formData, "newPjp") || str(formData, "pjp");
  const salesTarget = num(formData, "salesTarget");

  if (!/^\d{4}-\d{2}$/.test(month) || !distributor || !pjp || salesTarget === null) {
    redirect("/admin/unilever-kpis?error=" + encodeURIComponent("Month, distributor, PJP and Sales Target are all required."));
  }
  if (!(distributor in SALES_RETURNS_BRANCH_LABELS)) {
    redirect("/admin/unilever-kpis?error=" + encodeURIComponent("Unrecognized distributor."));
  }

  const [year, mo] = month.split("-").map(Number);
  const monthDate = new Date(Date.UTC(year, mo - 1, 1));

  await prisma.unileverKpiTarget.upsert({
    where: { month_distributor_pjp: { month: monthDate, distributor, pjp } },
    create: { month: monthDate, distributor, pjp, salesTarget },
    update: { salesTarget },
  });

  redirect(`/admin/unilever-kpis?success=` + encodeURIComponent(`Saved ${pjp} — ${month}.`) + `&month=${encodeURIComponent(month)}`);
}

export async function deleteTargetAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "targetId");
  const month = str(formData, "month");

  await prisma.unileverKpiTarget.delete({ where: { id } }).catch(() => null);

  redirect(`/admin/unilever-kpis?success=` + encodeURIComponent("Target removed.") + (month ? `&month=${encodeURIComponent(month)}` : ""));
}

export async function addAssortmentSkuAction(formData: FormData) {
  await requireAdmin();
  const sku = str(formData, "sku");
  const skuDesc = str(formData, "skuDesc");

  if (!sku) {
    redirect("/admin/unilever-kpis?error=" + encodeURIComponent("SKU code is required."));
  }

  try {
    await prisma.unileverAssortmentSku.create({ data: { sku, skuDesc: skuDesc || null } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `${sku} is already in the assortment basket.`
        : "Failed to add the SKU.";
    redirect("/admin/unilever-kpis?error=" + encodeURIComponent(message));
  }

  redirect("/admin/unilever-kpis?success=" + encodeURIComponent(`Added ${sku} to the core assortment basket.`));
}

export async function toggleAssortmentSkuAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "skuId");
  const active = str(formData, "active") === "true";

  await prisma.unileverAssortmentSku.update({ where: { id }, data: { active: !active } }).catch(() => null);

  redirect("/admin/unilever-kpis?success=" + encodeURIComponent("Updated the assortment basket."));
}

export async function deleteAssortmentSkuAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "skuId");

  await prisma.unileverAssortmentSku.delete({ where: { id } }).catch(() => null);

  redirect("/admin/unilever-kpis?success=" + encodeURIComponent("Removed the SKU from the assortment basket."));
}

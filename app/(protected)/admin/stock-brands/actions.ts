"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  return session.user;
}

/** Adds a brand rule: SKUs of the principal whose name starts with (or contains) the keyword get the brand. */
export async function addStockBrandRuleAction(formData: FormData) {
  const user = await requireAdmin();
  const principalKey = normalizePrincipalKey(String(formData.get("principal") ?? ""));
  const keyword = String(formData.get("keyword") ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const brand = String(formData.get("brand") ?? "").replace(/\s+/g, " ").trim();
  const mode = formData.get("mode") === "CONTAINS" ? "CONTAINS" : "PREFIX";
  if (!principalKey) redirect("/admin/stock-brands?error=" + encodeURIComponent("Choose a principal."));
  if (keyword.length < 2 || keyword.length > 60) redirect("/admin/stock-brands?error=" + encodeURIComponent("The keyword must be 2 to 60 characters."));
  if (brand.length < 2 || brand.length > 60) redirect("/admin/stock-brands?error=" + encodeURIComponent("The brand must be 2 to 60 characters."));
  await prisma.stockBrandRule.upsert({
    where: { principalKey_keyword_mode: { principalKey, keyword, mode } },
    create: { principalKey, keyword, brand, mode, createdBy: user.email ?? null },
    update: { brand, createdBy: user.email ?? null },
  });
  redirect("/admin/stock-brands?success=" + encodeURIComponent(`Rule saved: "${keyword}" -> ${brand}. The Stock screens use it now.`));
}

export async function deleteStockBrandRuleAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.stockBrandRule.deleteMany({ where: { id } });
  redirect("/admin/stock-brands?success=" + encodeURIComponent("Rule removed."));
}

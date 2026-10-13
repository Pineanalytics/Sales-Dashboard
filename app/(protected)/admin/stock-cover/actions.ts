"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_OVERSTOCK_DAYS, DEFAULT_REORDER_DAYS, DEFAULT_TARGET_DAYS } from "@/lib/standardStock";
import { OUT_OF_STOCK_DAYS } from "@/lib/stockThresholds";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  return session.user;
}

const MAX_DAYS = 365;
const FIELDS = ["targetDays", "reorderDays", "overstockDays"] as const;
type Field = (typeof FIELDS)[number];

interface RowEdit {
  scope: "PRINCIPAL" | "BRAND";
  principalKey: string;
  brand: string;
  label: string;
  values: Record<Field, number | null>;
}

/** Saves the cover targets on the form. A blank value inherits (a brand from its principal, a principal from the defaults); a row with
 *  all three blank is removed. Days must be whole numbers from the flat Out of Stock line (2) up to 365, and for each row the effective
 *  reorder days must not exceed its target days, nor the target its overstock days. */
export async function saveStockCoverTargetsAction(formData: FormData) {
  const user = await requireAdmin();
  const rows = new Map<string, RowEdit>();
  const problems: string[] = [];

  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("cell:")) continue;
    const [, scope, encodedKey, encodedBrand, field] = name.split(":");
    if ((scope !== "PRINCIPAL" && scope !== "BRAND") || !FIELDS.includes(field as Field)) continue;
    const principalKey = decodeURIComponent(encodedKey);
    const brand = decodeURIComponent(encodedBrand);
    const label = String(formData.get(`label:${scope}:${encodedKey}:${encodedBrand}`) ?? (brand || principalKey));
    const mapKey = `${scope}|${principalKey}|${brand}`;
    const entry = rows.get(mapKey) ?? { scope, principalKey, brand, label, values: { targetDays: null, reorderDays: null, overstockDays: null } };
    const text = String(raw).trim();
    if (text !== "") {
      const value = Number(text);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < OUT_OF_STOCK_DAYS || value > MAX_DAYS) {
        problems.push(`${label}: days must be a whole number from ${OUT_OF_STOCK_DAYS} to ${MAX_DAYS}.`);
      } else {
        entry.values[field as Field] = value;
      }
    }
    rows.set(mapKey, entry);
  }

  // The effective triple of each row (its own values, else its principal's, else the defaults) must keep reorder <= target <= overstock.
  const principalValues = (key: string) => rows.get(`PRINCIPAL|${key}|`)?.values;
  for (const row of rows.values()) {
    const inherited = row.scope === "BRAND" ? principalValues(row.principalKey) : undefined;
    const pick = (field: Field, fallback: number) => row.values[field] ?? inherited?.[field] ?? fallback;
    const target = pick("targetDays", DEFAULT_TARGET_DAYS);
    const reorder = pick("reorderDays", DEFAULT_REORDER_DAYS);
    const overstock = pick("overstockDays", DEFAULT_OVERSTOCK_DAYS);
    if (reorder > target || target > overstock) problems.push(`${row.label}: reorder days (${reorder}) must not exceed target days (${target}), and target days must not exceed overstock days (${overstock}).`);
  }
  if (problems.length > 0) redirect("/admin/stock-cover?error=" + encodeURIComponent(Array.from(new Set(problems)).join(" ")));

  let saved = 0;
  let removed = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of rows.values()) {
      const where = { scope_principalKey_brand: { scope: row.scope, principalKey: row.principalKey, brand: row.brand } };
      const empty = FIELDS.every((field) => row.values[field] === null);
      const existing = await tx.stockCoverTarget.findUnique({ where });
      if (empty) {
        if (existing) {
          await tx.stockCoverTarget.delete({ where });
          removed += 1;
        }
        continue;
      }
      if (existing && FIELDS.every((field) => existing[field] === row.values[field])) continue; // unchanged
      await tx.stockCoverTarget.upsert({
        where,
        create: { scope: row.scope, principalKey: row.principalKey, brand: row.brand, ...row.values, updatedBy: user.email ?? null },
        update: { ...row.values, updatedBy: user.email ?? null },
      });
      saved += 1;
    }
  });

  const message = saved === 0 && removed === 0 ? "No changes to save." : `Saved ${saved} row${saved === 1 ? "" : "s"}${removed > 0 ? `; ${removed} returned to inheriting` : ""}. The Stock screens use them now.`;
  redirect("/admin/stock-cover?success=" + encodeURIComponent(message));
}

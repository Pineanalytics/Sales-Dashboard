"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Prisma, type Target } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseTargetsWorkbook, TargetsParseError, type ParsedTargetRow } from "@/lib/parseTargets";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

const AUDITED_FIELDS = ["valueTarget", "volumeTarget", "coverageTarget", "productivityTarget"] as const;

function num(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

// Mirrors the source Target_Per_Principal_System.xlsm workbook's AuditTrail sheet —
// one row per row-level Add/Edit/Delete form submission (not written by the bulk
// upload path). `changes` only holds the fields that actually moved.
async function logTargetAudit(
  userEmail: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  target: Pick<Target, "year" | "month" | "principal">,
  before: Partial<Record<(typeof AUDITED_FIELDS)[number], number | null>>,
  after: Partial<Record<(typeof AUDITED_FIELDS)[number], number | null>>
) {
  const changes: Record<string, { old: number | null; new: number | null }> = {};
  for (const field of AUDITED_FIELDS) {
    const oldVal = before[field] ?? null;
    const newVal = after[field] ?? null;
    if (oldVal !== newVal) changes[field] = { old: oldVal, new: newVal };
  }
  if (Object.keys(changes).length === 0) return;

  await prisma.targetAuditLog.create({
    data: {
      userEmail,
      action,
      year: target.year,
      month: target.month,
      principal: target.principal,
      changes,
    },
  });
}

// Server actions run as Netlify functions with the same execution-time limit as API
// routes — one round-trip per row (the original approach) risks timing out on a
// large upload. Batched raw-SQL upsert turns N round-trips into a handful.
const CHUNK_SIZE = 500;

async function upsertTargetsChunk(rows: ParsedTargetRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.principal}, ${row.mainPrincipal}, ${row.valueTarget}, ${row.volumeTarget}, ${row.coverageTarget}, ${row.productivityTarget}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "Target" (id, year, month, "monthIndex", principal, "mainPrincipal", "valueTarget", "volumeTarget", "coverageTarget", "productivityTarget", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal)
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      "mainPrincipal" = EXCLUDED."mainPrincipal",
      "valueTarget" = EXCLUDED."valueTarget",
      "volumeTarget" = EXCLUDED."volumeTarget",
      "coverageTarget" = EXCLUDED."coverageTarget",
      "productivityTarget" = EXCLUDED."productivityTarget",
      "updatedAt" = now()
  `;
}

export async function uploadTargetsAction(formData: FormData) {
  await requireAdmin();

  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) {
    redirect("/admin/targets?error=" + encodeURIComponent("Attach a Targets file to upload."));
  }

  let rows;
  try {
    const buffer = await (file as File).arrayBuffer();
    rows = parseTargetsWorkbook(buffer);
  } catch (err) {
    const message = err instanceof TargetsParseError ? err.message : "Failed to read the uploaded file.";
    redirect("/admin/targets?error=" + encodeURIComponent(message));
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await upsertTargetsChunk(rows.slice(i, i + CHUNK_SIZE));
  }

  const years = Array.from(new Set(rows.map((r) => r.year)));
  redirect(
    `/admin/targets?year=${encodeURIComponent(years[0])}&success=` +
      encodeURIComponent(`Saved ${rows.length} target row(s).`)
  );
}

export async function createTargetAction(formData: FormData) {
  const user = await requireAdmin();

  const year = str(formData, "year");
  const month = str(formData, "month");
  const principal = str(formData, "principal");
  if (!year || !month || !principal) {
    redirect("/admin/targets?error=" + encodeURIComponent("Year, Month, and Principal are required."));
  }
  const monthIndex = CANONICAL_MONTHS.indexOf(month);
  if (monthIndex < 0) {
    redirect("/admin/targets?error=" + encodeURIComponent(`Unrecognized month "${month}".`));
  }

  const values = {
    valueTarget: num(formData, "valueTarget"),
    volumeTarget: num(formData, "volumeTarget"),
    coverageTarget: num(formData, "coverageTarget"),
    productivityTarget: num(formData, "productivityTarget"),
  };

  try {
    await prisma.target.create({
      data: {
        year,
        month,
        monthIndex,
        principal,
        mainPrincipal: str(formData, "mainPrincipal") || null,
        ...values,
      },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? `A target for ${principal} in ${month} ${year} already exists — edit it instead.`
        : "Failed to create the target.";
    redirect(`/admin/targets?year=${encodeURIComponent(year)}&error=` + encodeURIComponent(message));
  }

  await logTargetAudit(
    user.email!,
    "CREATE",
    { year, month, principal },
    { valueTarget: null, volumeTarget: null, coverageTarget: null, productivityTarget: null },
    values
  );

  redirect(
    `/admin/targets?year=${encodeURIComponent(year)}&success=` +
      encodeURIComponent(`Added ${principal} — ${month} ${year}.`)
  );
}

export async function updateTargetAction(formData: FormData) {
  const user = await requireAdmin();
  const id = str(formData, "targetId");
  const year = str(formData, "year");

  const existing = await prisma.target.findUnique({ where: { id } });
  if (!existing) {
    redirect(`/admin/targets?year=${encodeURIComponent(year)}&error=` + encodeURIComponent("Target not found."));
  }

  const values = {
    valueTarget: num(formData, "valueTarget"),
    volumeTarget: num(formData, "volumeTarget"),
    coverageTarget: num(formData, "coverageTarget"),
    productivityTarget: num(formData, "productivityTarget"),
  };

  try {
    await prisma.target.update({
      where: { id },
      data: {
        mainPrincipal: str(formData, "mainPrincipal") || null,
        ...values,
      },
    });
  } catch {
    redirect(`/admin/targets?year=${encodeURIComponent(year)}&error=` + encodeURIComponent("Failed to update the target."));
  }

  await logTargetAudit(
    user.email!,
    "UPDATE",
    existing,
    {
      valueTarget: existing.valueTarget,
      volumeTarget: existing.volumeTarget,
      coverageTarget: existing.coverageTarget,
      productivityTarget: existing.productivityTarget,
    },
    values
  );

  redirect(
    `/admin/targets?year=${encodeURIComponent(year)}&success=` +
      encodeURIComponent(`Updated ${existing.principal} — ${existing.month} ${existing.year}.`)
  );
}

export async function deleteTargetAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("targetId") || "");
  const year = String(formData.get("year") || "");

  const target = await prisma.target.findUnique({ where: { id } });
  if (!target) {
    redirect(`/admin/targets?year=${encodeURIComponent(year)}&error=` + encodeURIComponent("Target not found."));
  }

  await prisma.target.delete({ where: { id } });

  await logTargetAudit(
    user.email!,
    "DELETE",
    target,
    {
      valueTarget: target.valueTarget,
      volumeTarget: target.volumeTarget,
      coverageTarget: target.coverageTarget,
      productivityTarget: target.productivityTarget,
    },
    { valueTarget: null, volumeTarget: null, coverageTarget: null, productivityTarget: null }
  );

  redirect(
    `/admin/targets?year=${encodeURIComponent(year)}&success=` +
      encodeURIComponent(`Removed ${target.principal} — ${target.month} ${target.year}.`)
  );
}

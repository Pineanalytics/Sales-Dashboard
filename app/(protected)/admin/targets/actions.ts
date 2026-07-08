"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseTargetsWorkbook, TargetsParseError, type ParsedTargetRow } from "@/lib/parseTargets";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
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

export async function deleteTargetAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("targetId") || "");
  const year = String(formData.get("year") || "");

  const target = await prisma.target.findUnique({ where: { id } });
  if (!target) {
    redirect(`/admin/targets?year=${encodeURIComponent(year)}&error=` + encodeURIComponent("Target not found."));
  }

  await prisma.target.delete({ where: { id } });
  redirect(
    `/admin/targets?year=${encodeURIComponent(year)}&success=` +
      encodeURIComponent(`Removed ${target.principal} — ${target.month} ${target.year}.`)
  );
}

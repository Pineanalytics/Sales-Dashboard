"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseTargetsWorkbook, TargetsParseError } from "@/lib/parseTargets";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
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

  for (const row of rows) {
    await prisma.target.upsert({
      where: { year_month_principal: { year: row.year, month: row.month, principal: row.principal } },
      update: {
        monthIndex: row.monthIndex,
        mainPrincipal: row.mainPrincipal,
        valueTarget: row.valueTarget,
        volumeTarget: row.volumeTarget,
        coverageTarget: row.coverageTarget,
        productivityTarget: row.productivityTarget,
      },
      create: {
        year: row.year,
        month: row.month,
        monthIndex: row.monthIndex,
        principal: row.principal,
        mainPrincipal: row.mainPrincipal,
        valueTarget: row.valueTarget,
        volumeTarget: row.volumeTarget,
        coverageTarget: row.coverageTarget,
        productivityTarget: row.productivityTarget,
      },
    });
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

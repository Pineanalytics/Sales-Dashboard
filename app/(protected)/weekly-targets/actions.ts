"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdminOrTeamLeader() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
    redirect("/");
  }
  return session.user;
}

// A TEAM_LEADER can only ever touch their own rows — this is the one place in the
// app where row ownership (not just page visibility) gates a write, so it's
// checked directly against the row's teamLeaderId rather than relying on the UI
// not rendering another team leader's grid.
async function assertOwnsTeamLeader(user: { role: string; teamLeaderId: string | null }, teamLeaderId: string) {
  if (user.role === "ADMIN") return;
  if (user.teamLeaderId !== teamLeaderId) {
    redirect("/weekly-targets?error=" + encodeURIComponent("You can only edit your own Weekly Targets."));
  }
}

export async function saveWeeklyTargetsAction(formData: FormData) {
  const user = await requireAdminOrTeamLeader();
  const teamLeaderId = String(formData.get("teamLeaderId") || "");
  const year = String(formData.get("year") || "");
  const month = String(formData.get("month") || "");
  await assertOwnsTeamLeader(user, teamLeaderId);

  // Cells are named "cell__<weeklyTargetId>" so we don't have to re-derive the
  // (principal, weekStartDate) key from form field names — the row already exists
  // from ensureWeeklyTargetGrid() by the time this form renders.
  const cellEntries = Array.from(formData.entries()).filter(([key]) => key.startsWith("cell__"));

  const ids = cellEntries.map(([key]) => key.slice("cell__".length));
  const existingRows = await prisma.weeklyTarget.findMany({ where: { id: { in: ids }, teamLeaderId } });
  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  let changedCount = 0;
  for (const [key, rawValue] of cellEntries) {
    const id = key.slice("cell__".length);
    const row = existingById.get(id);
    if (!row) continue;

    const trimmed = String(rawValue).trim();
    const newValue = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isFinite(newValue) || newValue === row.targetValue) continue;

    await prisma.weeklyTarget.update({
      where: { id },
      data: { targetValue: newValue, lastModifiedBy: user.email ?? undefined },
    });
    await prisma.weeklyTargetAuditLog.create({
      data: {
        userEmail: user.email ?? "unknown",
        action: "UPDATE",
        teamLeaderId,
        principal: row.principal,
        weekStartDate: row.weekStartDate,
        changes: { targetValue: { old: row.targetValue, new: newValue } },
      },
    });
    changedCount += 1;
  }

  const suffix = `&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&teamLeader=${encodeURIComponent(teamLeaderId)}`;
  redirect(`/weekly-targets?success=${encodeURIComponent(changedCount > 0 ? `Saved ${changedCount} change(s).` : "No changes to save.")}${suffix}`);
}

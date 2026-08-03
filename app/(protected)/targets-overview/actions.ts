"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { Target, TeamLeaderAssignment } from "@prisma/client";

async function requireViewer() {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
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

function pct(formData: FormData, name: string): number | null {
  const raw = str(formData, name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null; // form takes a whole-number percent, stored as a fraction
}

// Carries the active filter bar through an edit round-trip, same convention
// as admin/team-leaders/actions.ts's filterSuffix.
const FILTER_KEYS = ["year", "month", "principal", "teamLeaderId", "employeeCode", "region"] as const;
function filterSuffix(formData: FormData): string {
  let suffix = "";
  for (const key of FILTER_KEYS) {
    const value = str(formData, `filter_${key}`);
    if (value) suffix += `&${key}=${encodeURIComponent(value)}`;
  }
  return suffix;
}

const REDIRECT_BASE = "/targets-overview";

const AUDITED_TARGET_FIELDS = ["valueTarget", "volumeTarget", "coverageTarget", "productivityTarget"] as const;

async function logTargetAudit(
  userEmail: string,
  target: Pick<Target, "year" | "month" | "principal">,
  before: Partial<Record<(typeof AUDITED_TARGET_FIELDS)[number], number | null>>,
  after: Partial<Record<(typeof AUDITED_TARGET_FIELDS)[number], number | null>>
) {
  const changes: Record<string, { old: number | null; new: number | null }> = {};
  for (const field of AUDITED_TARGET_FIELDS) {
    const oldVal = before[field] ?? null;
    const newVal = after[field] ?? null;
    if (oldVal !== newVal) changes[field] = { old: oldVal, new: newVal };
  }
  if (Object.keys(changes).length === 0) return;
  await prisma.targetAuditLog.create({
    data: { userEmail, action: "UPDATE", year: target.year, month: target.month, principal: target.principal, changes },
  });
}

const AUDITED_ASSIGNMENT_FIELDS = ["channel", "contributionPct", "region", "subRegion"] as const;

async function logAssignmentAudit(
  userEmail: string,
  assignment: Pick<TeamLeaderAssignment, "teamLeaderId" | "principal" | "employeeCode">,
  before: Partial<Record<(typeof AUDITED_ASSIGNMENT_FIELDS)[number], string | number | null>>,
  after: Partial<Record<(typeof AUDITED_ASSIGNMENT_FIELDS)[number], string | number | null>>
) {
  const changes: Record<string, { old: string | number | null; new: string | number | null }> = {};
  for (const field of AUDITED_ASSIGNMENT_FIELDS) {
    const oldVal = before[field] ?? null;
    const newVal = after[field] ?? null;
    if (oldVal !== newVal) changes[field] = { old: oldVal, new: newVal };
  }
  if (Object.keys(changes).length === 0) return;
  await prisma.teamLeaderAssignmentAuditLog.create({
    data: { userEmail, action: "UPDATE", teamLeaderId: assignment.teamLeaderId, principal: assignment.principal, employeeCode: assignment.employeeCode, changes },
  });
}

/** Edits the shared, principal-level Monthly Target (Value/Volume/Coverage/
 *  Productivity) — the official company commitment for that principal.
 *  Admin-only: a Team Leader's own amend rights live at the rep level
 *  (updateAssignmentMetadataAction's contributionPct) and the Weekly Target
 *  level (app/(protected)/weekly-targets — a Team Leader's weekly
 *  projections must sum toward this same Monthly figure, but never edit it
 *  directly). Reverses an earlier version of this action that let any Team
 *  Leader sharing a principal edit the Monthly figure directly — per direct
 *  correction, that's now reserved for Admin. */
export async function updateTargetValueAction(formData: FormData) {
  const user = await requireViewer();
  const suffix = filterSuffix(formData);
  if (user.role !== "ADMIN") {
    redirect(`${REDIRECT_BASE}?error=` + encodeURIComponent("Only an admin can edit the official Monthly Target.") + suffix);
  }
  const year = str(formData, "year");
  const month = str(formData, "month");
  const principal = str(formData, "principal");

  if (!year || !month || !principal) {
    redirect(`${REDIRECT_BASE}?error=` + encodeURIComponent("Missing year/month/principal.") + suffix);
  }

  const values = {
    valueTarget: num(formData, "valueTarget"),
    volumeTarget: num(formData, "volumeTarget"),
    coverageTarget: num(formData, "coverageTarget"),
    productivityTarget: num(formData, "productivityTarget"),
  };

  const existing = await prisma.target.findUnique({ where: { year_month_principal: { year, month, principal } } });

  await prisma.target.upsert({
    where: { year_month_principal: { year, month, principal } },
    update: values,
    create: { year, month, monthIndex: CANONICAL_MONTHS.indexOf(month), principal, ...values },
  });

  await logTargetAudit(
    user.email!,
    { year, month, principal },
    existing
      ? { valueTarget: existing.valueTarget, volumeTarget: existing.volumeTarget, coverageTarget: existing.coverageTarget, productivityTarget: existing.productivityTarget }
      : { valueTarget: null, volumeTarget: null, coverageTarget: null, productivityTarget: null },
    values
  );
  invalidateDatasetCache();

  redirect(`${REDIRECT_BASE}?success=` + encodeURIComponent(`Updated ${principal} — ${month} ${year}.`) + suffix);
}

/** Edits one rep's own roster metadata (channel, contribution %, region, sub
 *  region). Permission: an ADMIN can edit any assignment; a TEAM_LEADER can
 *  only edit assignments owned by their own teamLeaderId — deliberately
 *  stricter than the target-value check above, matching "their own reps'
 *  roster metadata," never another Team Leader's rep even on a shared
 *  principal. */
export async function updateAssignmentMetadataAction(formData: FormData) {
  const user = await requireViewer();
  const suffix = filterSuffix(formData);
  const id = str(formData, "assignmentId");

  const existing = await prisma.teamLeaderAssignment.findUnique({ where: { id } });
  if (!existing) {
    redirect(`${REDIRECT_BASE}?error=` + encodeURIComponent("Assignment not found.") + suffix);
  }

  if (user.role === "TEAM_LEADER" && existing.teamLeaderId !== user.teamLeaderId) {
    redirect(`${REDIRECT_BASE}?error=` + encodeURIComponent("You can only edit your own reps.") + suffix);
  }

  const values = {
    channel: str(formData, "channel") || null,
    contributionPct: pct(formData, "contributionPct"),
    region: str(formData, "region") || null,
    subRegion: str(formData, "subRegion") || null,
  };

  await prisma.teamLeaderAssignment.update({ where: { id }, data: values });

  await logAssignmentAudit(
    user.email!,
    existing,
    { channel: existing.channel, contributionPct: existing.contributionPct, region: existing.region, subRegion: existing.subRegion },
    values
  );
  await recomputeRepContribution();
  await recomputeDailyTargets();

  redirect(`${REDIRECT_BASE}?success=` + encodeURIComponent(`Updated ${existing.employeeName} — ${existing.principal}.`) + suffix);
}

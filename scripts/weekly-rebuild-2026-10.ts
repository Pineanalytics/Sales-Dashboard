// One-off rebuild of the 2026 weekly targets from the 2026 monthly targets, for the current roster structure.
//
//   npx tsx scripts/weekly-rebuild-2026-10.ts            DRY RUN: plans everything, prints it, rolls it all back
//   npx tsx scripts/weekly-rebuild-2026-10.ts --apply    the same, committed (then recomputes daily targets)
//
// The planning is lib/weeklyRebuild.ts (read its header for the rules). This script gathers the inputs, applies the plan
// in ONE transaction and checks, before committing, that every principal-month's weeks add up to its monthly target to
// the cent; any shortfall aborts an --apply run and leaves the data untouched. Every changed row gets a
// WeeklyTargetAuditLog entry under "2026 weekly rebuild", so the old figures can be read back. Run
// scripts/org-restructure-2026-10.ts first: who carries a principal is decided by the roster as it stands.
//
// Who carries a principal: the team leader rows that hold its active PRIMARY reps (a supervisor's direct team counts,
// a former leader never does), weighted by those reps' revenue share, using the same precedence as the daily
// projection (declared Contribution %, else the computed share, else an even split). A principal with no such rows
// falls back to its own team leader row.
//
// A key-accounts rep (KEY_ACCOUNTS_REPS) first gets a roster row of her own, and the plan gives that row a fixed monthly
// amount (KEY_ACCOUNT_MONTHLY_TARGETS); the leaders share the rest. Safe to re-run: the plan starts from the monthly
// targets each time.
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";
import { resolveRepSharePct } from "../lib/repContribution";
import { normalizeTeamLeaderKind } from "../lib/teamLeaderKind";
import { KEY_ACCOUNT_MONTHLY_TARGETS, planWeeklyRebuild, type Recipient, type WeeklyRow } from "../lib/weeklyRebuild";

const YEAR = 2026;
const EDITOR = "2026 weekly rebuild";
const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}

const log = (message: string) => console.log(message);
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// Key-accounts reps who sit in a supervisor's team beside the team leaders: each gets a roster row of her own (kind
// KEY_ACCOUNTS, under the same Sales Supervisor) that holds her assignment and her fixed monthly target, so the
// supervisor's row carries no target of its own.
const KEY_ACCOUNTS_REPS = [{ name: "Clarrine Wahome", principal: "Mars-Nairobi" }];

async function placeKeyAccountsReps(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  for (const rep of KEY_ACCOUNTS_REPS) {
    const assignments = await tx.teamLeaderAssignment.findMany({ where: { employeeName: rep.name, principal: rep.principal, active: true, salesRole: "PRIMARY" } });
    if (assignments.length === 0) {
      log(`Key accounts: no active ${rep.principal} assignment for ${rep.name}; nothing to place.`);
      continue;
    }
    const currentRows = await tx.teamLeader.findMany({ where: { id: { in: assignments.map((a) => a.teamLeaderId) } } });
    const currentName = (id: string) => currentRows.find((r) => r.id === id)?.name ?? id;
    const supervisorId = currentRows[0]?.supervisorId ?? null;
    let row = await tx.teamLeader.findUnique({ where: { name: rep.name } });
    if (!row) row = await tx.teamLeader.create({ data: { name: rep.name, kind: "KEY_ACCOUNTS", supervisorId } });
    else if (row.kind !== "KEY_ACCOUNTS" || row.supervisorId !== supervisorId) row = await tx.teamLeader.update({ where: { id: row.id }, data: { kind: "KEY_ACCOUNTS", supervisorId } });
    for (const a of assignments) {
      if (a.teamLeaderId === row.id) continue;
      await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { teamLeaderId: row.id } });
      log(`Key accounts: ${rep.name} (${rep.principal}) moved from ${currentName(a.teamLeaderId)}'s row to her own row, under the same supervisor.`);
    }
  }
}

async function run(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  await placeKeyAccountsReps(tx);
  const [weeklyRows, monthlyRows, teamLeaders, assignments, contributions, principals] = await Promise.all([
    tx.weeklyTarget.findMany({ where: { year: String(YEAR) }, select: { id: true, teamLeaderId: true, principal: true, monthLabel: true, weekLabel: true, weekStartDate: true, targetValue: true } }),
    tx.target.findMany({ where: { year: String(YEAR) }, select: { principal: true, month: true, valueTarget: true } }),
    tx.teamLeader.findMany({ select: { id: true, name: true, kind: true } }),
    tx.teamLeaderAssignment.findMany({ where: { active: true, salesRole: "PRIMARY" }, select: { teamLeaderId: true, principal: true, employeeCode: true, contributionPct: true } }),
    tx.repContribution.findMany({ select: { principal: true, employeeCode: true, sharePct: true } }),
    tx.principal.findMany({ select: { principal: true, teamLeaderId: true } }),
  ]);

  const weekly: WeeklyRow[] = weeklyRows.map((r) => ({ id: r.id, teamLeaderId: r.teamLeaderId, principal: r.principal, monthLabel: r.monthLabel, weekLabel: r.weekLabel, start: isoDay(r.weekStartDate), value: r.targetValue }));
  const monthly = monthlyRows.map((r) => ({ principal: r.principal, month: r.month, value: r.valueTarget }));
  const nameById = new Map(teamLeaders.map((t) => [t.id, t.name]));
  const kindById = new Map(teamLeaders.map((t) => [t.id, t.kind]));
  const eligible = new Set(teamLeaders.filter((t) => normalizeTeamLeaderKind(t.kind) !== "FORMER").map((t) => t.id));
  const computedShare = new Map(contributions.map((c) => [`${c.principal}|${c.employeeCode}`, c.sharePct]));

  const recipientsByPrincipal = new Map<string, Recipient[]>();
  for (const principal of new Set(monthly.map((m) => m.principal))) {
    const reps = assignments.filter((a) => a.principal === principal && eligible.has(a.teamLeaderId));
    const weights = new Map<string, number>();
    for (const rep of reps) {
      const share = resolveRepSharePct(rep.contributionPct, computedShare.get(`${principal}|${rep.employeeCode}`), 1 / reps.length);
      weights.set(rep.teamLeaderId, (weights.get(rep.teamLeaderId) ?? 0) + share);
    }
    if (weights.size === 0) {
      const own = principals.find((p) => p.principal === principal)?.teamLeaderId;
      if (own && eligible.has(own)) weights.set(own, 1);
    }
    // A key-accounts row carries its fixed monthly amount; the other rows share what is left by weight.
    const fixedFor = KEY_ACCOUNT_MONTHLY_TARGETS[principal];
    if (weights.size > 0) {
      recipientsByPrincipal.set(
        principal,
        [...weights].map(([teamLeaderId, weight]) =>
          fixedFor !== undefined && normalizeTeamLeaderKind(kindById.get(teamLeaderId)) === "KEY_ACCOUNTS" ? { teamLeaderId, weight, fixedMonthly: fixedFor } : { teamLeaderId, weight }
        )
      );
    }
  }

  const plan = planWeeklyRebuild({ year: YEAR, weekly, monthly, recipientsByPrincipal });

  // ---- report ----
  const before = weeklyRows.reduce((s, r) => s + r.targetValue, 0);
  log(`Weekly rows ${weeklyRows.length}, total ${money(before)}. Monthly targets ${money(monthlyRows.reduce((s, r) => s + (r.valueTarget ?? 0), 0))}.`);
  log(`Plan: ${plan.updates.length} row(s) changed (${plan.mondayZeroed} legacy Monday-start rows zeroed, ${plan.updates.filter((u) => u.relabel).length} relabelled), ${plan.inserts.length} row(s) added.`);
  if (plan.unplaced.length > 0) log(`NOT PLACED (no team leader row carries the principal, left as is): ${plan.unplaced.join("; ")}`);

  log("\nWho carries each principal (share of the monthly target):");
  for (const [principal, recipients] of [...recipientsByPrincipal].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = recipients.reduce((s, r) => s + r.weight, 0);
    log(`  ${principal.padEnd(22)} ${recipients.sort((a, b) => b.weight - a.weight).map((r) => (r.fixedMonthly !== undefined ? `${nameById.get(r.teamLeaderId) ?? r.teamLeaderId} fixed ${money(r.fixedMonthly)}/month` : `${nameById.get(r.teamLeaderId) ?? r.teamLeaderId} ${total > 0 ? Math.round((r.weight / total) * 100) : 0}%`)).join(", ")}`);
  }

  const byPrincipal = new Map<string, { target: number; planned: number }>();
  for (const t of plan.totals) {
    const entry = byPrincipal.get(t.principal) ?? { target: 0, planned: 0 };
    entry.target += t.target;
    entry.planned += t.planned;
    byPrincipal.set(t.principal, entry);
  }
  log("\nPrincipal            monthly total        weeks total");
  for (const [principal, t] of [...byPrincipal].sort((a, b) => a[0].localeCompare(b[0]))) log(`  ${principal.padEnd(22)} ${money(t.target).padStart(14)} ${money(t.planned).padStart(14)}${Math.abs(t.target - t.planned) > 0.01 ? "   <-- differs (see NOT PLACED)" : ""}`);

  const placedTargets = plan.totals.filter((t) => !plan.unplaced.includes(`${t.principal} ${t.month}`));
  const off = placedTargets.filter((t) => Math.abs(t.target - t.planned) > 0.01);

  // ---- apply ----
  for (const u of plan.updates) {
    await tx.weeklyTarget.update({ where: { id: u.id }, data: { targetValue: u.newValue, monthLabel: u.month, weekLabel: u.label, lastModifiedBy: EDITOR } });
  }
  if (plan.inserts.length > 0) {
    await tx.weeklyTarget.createMany({
      data: plan.inserts.map((i) => ({ teamLeaderId: i.teamLeaderId, principal: i.principal, year: String(YEAR), monthLabel: i.month, weekLabel: i.label, weekStartDate: new Date(`${i.start}T00:00:00Z`), targetValue: i.newValue, lastModifiedBy: EDITOR })),
      skipDuplicates: false,
    });
  }
  const changedValues = plan.updates.filter((u) => u.oldValue !== u.newValue);
  await tx.weeklyTargetAuditLog.createMany({
    data: [
      ...changedValues.map((u) => ({ userEmail: EDITOR, action: "UPDATE", teamLeaderId: u.teamLeaderId, principal: u.principal, weekStartDate: new Date(`${u.start}T00:00:00Z`), changes: { targetValue: { old: u.oldValue, new: u.newValue } } })),
      ...plan.inserts.map((i) => ({ userEmail: EDITOR, action: "CREATE", teamLeaderId: i.teamLeaderId, principal: i.principal, weekStartDate: new Date(`${i.start}T00:00:00Z`), changes: { targetValue: { old: 0, new: i.newValue } } })),
    ],
  });

  // ---- check what the database now holds, before anything is committed ----
  const after = await tx.weeklyTarget.findMany({ where: { year: String(YEAR) }, select: { principal: true, monthLabel: true, targetValue: true, weekStartDate: true } });
  const held = new Map<string, number>();
  for (const r of after) {
    if (r.weekStartDate.getUTCDay() !== 0) continue;
    const key = `${r.principal}|${r.monthLabel}`;
    held.set(key, (held.get(key) ?? 0) + r.targetValue);
  }
  const mismatches = placedTargets.filter((t) => t.target > 0 && Math.abs((held.get(`${t.principal}|${t.month}`) ?? 0) - t.target) > 0.01);
  const mondayLeft = after.filter((r) => r.weekStartDate.getUTCDay() === 1 && r.targetValue !== 0).length;
  log(`\nAfter: weekly total ${money(after.reduce((s, r) => s + r.targetValue, 0))}; principal-months not matching their monthly target: ${mismatches.length}${off.length > 0 ? ` (plan itself off: ${off.length})` : ""}; non-zero Monday-start rows left: ${mondayLeft}.`);
  for (const m of mismatches.slice(0, 10)) log(`  ${m.principal} ${m.month}: target ${money(m.target)}, weeks hold ${money(held.get(`${m.principal}|${m.month}`) ?? 0)}`);

  if ((mismatches.length > 0 || off.length > 0 || mondayLeft > 0) && apply) throw new Error("The weeks do not add up to the monthly targets; nothing was changed.");
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 900_000, maxWait: 60_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("\nDRY RUN finished and rolled back. Re-run with --apply to commit.");
    return;
  }
  log("\nCommitted. Recomputing rep contribution and daily targets...");
  await recomputeRosterDerived();
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

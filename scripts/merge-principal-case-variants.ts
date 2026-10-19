// One-off clean-up: principals that exist twice, spelled differently by case ("Eabl-Nyeri" next to "EABL-Nyeri").
//
//   node --import tsx scripts/merge-principal-case-variants.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/merge-principal-case-variants.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Everything runs in ONE transaction, so it lands completely or not at all; a problem it cannot resolve safely aborts an --apply run.
// Back up Principal, TeamLeaderAssignment, WeeklyTarget, EmployeePrincipalContribution and EmployeeMaster first. Idempotent.
//
// The canonical spelling of a group is its OLDEST Principal row (the one SAP sales, targets and reporting already use). For every other
// spelling:
//   - Team Leader assignments: moved to the canonical name; where the canonical row already exists for the same Team Leader and rep, the
//     duplicate is removed (the canonical row carries the declared contribution %).
//   - Weekly targets: moved; where the canonical week already exists the duplicate is removed, after checking its value is zero or equal
//     (a non-zero, different value is reported and aborts an --apply run, never silently dropped).
//   - Employee contribution and the employee master's absolute principal: moved to the canonical name (duplicates removed).
//   - Contribution-by-rep rows are derived: the recompute that follows an --apply run rebuilds them under the canonical name.
//   - The duplicate Principal row is deleted once nothing but audit history and derived rows refer to it. Audit-log rows keep the spelling they were written with.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";
import { findPrincipalVariantGroups } from "../lib/principalNames";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}

const problems: string[] = [];
const log = (message: string) => console.log(message);
const problem = (message: string) => {
  problems.push(message);
  console.log(`  !! PROBLEM: ${message}`);
};

// Tables this script moves itself, plus history tables that keep the spelling they were written with.
const HANDLED = new Set(["Principal.principal", "TeamLeaderAssignment.principal", "TeamLeaderAssignment.absolutePrincipal", "WeeklyTarget.principal", "EmployeePrincipalContribution.principal", "EmployeeMaster.absolutePrincipal"]);
const HISTORY = new Set(["TeamLeaderAssignmentAuditLog.principal", "WeeklyTargetAuditLog.principal", "TargetAuditLog.principal"]);
// Derived tables that recomputeRosterDerived() wipes and rebuilds from the roster after an --apply run, so the old spelling disappears by itself.
const DERIVED = new Set(["RepContribution.principal"]);

async function run(tx: Prisma.TransactionClient) {
  const principals = await tx.principal.findMany({ select: { id: true, principal: true, createdAt: true, teamLeaderId: true, supervisorId: true, status: true } });
  const groups = findPrincipalVariantGroups(principals);
  log(`\n1. Principals spelled twice: ${groups.length} group(s).`);
  if (groups.length === 0) return;
  const byName = new Map(principals.map((p) => [p.principal, p]));

  const columns = await tx.$queryRaw<{ table_name: string; column_name: string }[]>(Prisma.sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('principal', 'absolutePrincipal') ORDER BY 1, 2`);

  for (const group of groups) {
    const canonical = byName.get(group.canonical)!;
    log(`\n  ${group.canonical}  <-  ${group.variants.join(", ")}`);
    for (const variant of group.variants) {
      const v = byName.get(variant)!;
      if (v.teamLeaderId !== canonical.teamLeaderId) problem(`${variant} and ${group.canonical} name different Team Leaders (${v.teamLeaderId} vs ${canonical.teamLeaderId}).`);
      if (v.status !== canonical.status) problem(`${variant} is ${v.status} but ${group.canonical} is ${canonical.status}.`);

      // Anything else that holds the variant spelling must be known to this script, or an --apply run stops.
      for (const { table_name, column_name } of columns) {
        const key = `${table_name}.${column_name}`;
        const [{ n }] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "${table_name}" WHERE "${column_name}" = $1`, variant);
        if (n === 0) continue;
        if (HISTORY.has(key)) log(`  history kept as written: ${key} (${n})`);
        else if (DERIVED.has(key)) log(`  rebuilt by the recompute afterwards: ${key} (${n})`);
        else if (!HANDLED.has(key)) problem(`${key} holds ${n} row(s) spelled "${variant}" and this script does not know how to move them.`);
      }

      // Team Leader assignments
      const assignments = await tx.teamLeaderAssignment.findMany({ where: { principal: variant } });
      let moved = 0;
      let removed = 0;
      for (const a of assignments) {
        const twin = await tx.teamLeaderAssignment.findUnique({ where: { teamLeaderId_employeeCode_principal: { teamLeaderId: a.teamLeaderId, employeeCode: a.employeeCode, principal: canonical.principal } } });
        if (twin) {
          if (a.active && !twin.active) problem(`${a.employeeCode} (${a.employeeName}) is active as "${variant}" but inactive as "${canonical.principal}" for the same Team Leader.`);
          await tx.teamLeaderAssignment.delete({ where: { id: a.id } });
          removed++;
        } else {
          await tx.teamLeaderAssignment.update({ where: { id: a.id }, data: { principal: canonical.principal } });
          moved++;
        }
      }
      log(`  Team Leader assignments: ${moved} moved, ${removed} duplicates removed.`);
      const absoluteMoved = await tx.teamLeaderAssignment.updateMany({ where: { absolutePrincipal: variant }, data: { absolutePrincipal: canonical.principal } });
      if (absoluteMoved.count > 0) log(`  assignment absolute principal: ${absoluteMoved.count} renamed.`);

      // Weekly targets
      const weeks = await tx.weeklyTarget.findMany({ where: { principal: variant } });
      let weeksMoved = 0;
      let weeksRemoved = 0;
      for (const w of weeks) {
        const twin = await tx.weeklyTarget.findUnique({ where: { teamLeaderId_principal_weekStartDate: { teamLeaderId: w.teamLeaderId, principal: canonical.principal, weekStartDate: w.weekStartDate } } });
        if (twin) {
          if (w.targetValue !== 0 && w.targetValue !== twin.targetValue) {
            if (twin.targetValue === 0) await tx.weeklyTarget.update({ where: { id: twin.id }, data: { targetValue: w.targetValue } });
            else problem(`Weekly target ${w.weekLabel} ${w.monthLabel}: "${variant}" has ${w.targetValue}, "${canonical.principal}" has ${twin.targetValue}.`);
          }
          await tx.weeklyTarget.delete({ where: { id: w.id } });
          weeksRemoved++;
        } else {
          await tx.weeklyTarget.update({ where: { id: w.id }, data: { principal: canonical.principal } });
          weeksMoved++;
        }
      }
      log(`  Weekly targets: ${weeksMoved} moved, ${weeksRemoved} duplicates removed.`);

      // Employee contribution and the employee master
      const contributions = await tx.employeePrincipalContribution.findMany({ where: { principal: variant } });
      let contributionsMoved = 0;
      let contributionsRemoved = 0;
      for (const c of contributions) {
        const twin = await tx.employeePrincipalContribution.findUnique({ where: { employeeId_principal: { employeeId: c.employeeId, principal: canonical.principal } } });
        if (twin) {
          await tx.employeePrincipalContribution.delete({ where: { id: c.id } });
          contributionsRemoved++;
        } else {
          await tx.employeePrincipalContribution.update({ where: { id: c.id }, data: { principal: canonical.principal } });
          contributionsMoved++;
        }
      }
      log(`  Employee contribution: ${contributionsMoved} moved, ${contributionsRemoved} duplicates removed.`);
      const employees = await tx.employeeMaster.updateMany({ where: { absolutePrincipal: variant }, data: { absolutePrincipal: canonical.principal } });
      log(`  Employee master absolute principal: ${employees.count} renamed.`);

      await tx.principal.delete({ where: { id: v.id } });
      log(`  Principal row "${variant}" deleted.`);
    }
  }

  if (problems.length > 0 && apply) throw new Error(`${problems.length} problem(s) found; nothing was changed.\n- ${problems.join("\n- ")}`);
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 300_000, maxWait: 60_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log(`\nDRY RUN finished and rolled back. ${problems.length} problem(s). Re-run with --apply to commit.`);
    return;
  }
  if (!apply) return;
  log("\nRecomputing rep contribution, daily targets and employee identities ...");
  await recomputeRosterDerived();
  log("Done. The dashboard's in-memory dataset refreshes within five minutes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

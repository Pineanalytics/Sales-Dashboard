// One-off (19 Oct 2026): two EABL roster corrections ruled by the business.
//
//   node --import tsx scripts/eabl-roster-fixes-2026-10.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/eabl-roster-fixes-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container: the recompute needs more than the 512 MB live-sync worker has.
// One transaction; idempotent (a second run finds the work done).
//
//   1. PFL031 is ISAAC NJOROGE-NDARAGWA (SAP's name for the rep); the roster still carried the previous holder's name, ELIJAH MBURU-NDARAGWA.
//   2. PFL033 JOHN MWANIKI-NYAHURURU TOWN works from Nyahururu (ISD, Nyahururu region) but sat under EABL-Nyeri and Richard. He moves to
//      EABL-Nyahururu under Erick: employee master, contribution, and the Team Leader assignment (with an audit-log entry).
//   3. His declared contribution % (20%) moves with him, so each principal's active declared percentages are scaled proportionally back to
//      100% (the admin screen requires ~100%): Nyahururu absorbs him, Nyeri closes the gap he leaves.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const FROM_PRINCIPAL = "EABL-Nyeri";
const TO_PRINCIPAL = "EABL-Nyahururu";
const AUDIT_USER = "system: eabl roster fix 2026-10-19";

async function normalizeDeclaredPct(tx: Prisma.TransactionClient, principal: string) {
  const rows = await tx.teamLeaderAssignment.findMany({ where: { principal, active: true, contributionPct: { not: null } }, select: { id: true, employeeCode: true, contributionPct: true } });
  const sum = rows.reduce((s, r) => s + (r.contributionPct ?? 0), 0);
  if (rows.length === 0 || sum <= 0) return;
  log(`  ${principal}: declared active total ${(sum * 100).toFixed(1)}% across ${rows.length} reps` + (Math.abs(sum - 1) < 0.0005 ? " (already 100%)." : " -> scaled to 100%."));
  if (Math.abs(sum - 1) < 0.0005) return;
  for (const r of rows) await tx.teamLeaderAssignment.update({ where: { id: r.id }, data: { contributionPct: (r.contributionPct ?? 0) / sum } });
}

async function run(tx: Prisma.TransactionClient) {
  log("\n1. PFL031 name");
  const isaac = "ISAAC NJOROGE-NDARAGWA";
  const em31 = await tx.employeeMaster.updateMany({ where: { employeeCode: "PFL031", pineName: { not: isaac } }, data: { pineName: isaac } });
  const tla31 = await tx.teamLeaderAssignment.updateMany({ where: { employeeCode: "PFL031", employeeName: { not: isaac } }, data: { employeeName: isaac } });
  log(`  employee master: ${em31.count} renamed; assignments: ${tla31.count} renamed.`);

  log("\n2. PFL033 moves to EABL-Nyahururu under Erick");
  const [erick, richard] = await Promise.all([tx.teamLeader.findFirst({ where: { name: "Erick" } }), tx.teamLeader.findFirst({ where: { name: "Richard" } })]);
  if (!erick || !richard) throw new Error("Team Leader Erick or Richard not found.");
  const erickRow = await tx.teamLeaderAssignment.findFirst({ where: { teamLeaderId: erick.id, principal: TO_PRINCIPAL, active: true }, select: { supervisorId: true, managerId: true } });
  const master = await tx.employeeMaster.findUnique({ where: { employeeCode: "PFL033" }, select: { id: true, absolutePrincipal: true, teamLeader: true, supervisor: true } });
  if (!master) throw new Error("PFL033 is not in the employee master.");

  const alreadyMoved = master.absolutePrincipal === TO_PRINCIPAL && master.teamLeader === "Erick";
  if (alreadyMoved) log("  already moved: nothing to do.");
  else {
    await tx.employeeMaster.update({ where: { id: master.id }, data: { absolutePrincipal: TO_PRINCIPAL, teamLeader: "Erick", supervisor: "Erick" } });
    const epc = await tx.employeePrincipalContribution.updateMany({ where: { employeeId: master.id, principal: FROM_PRINCIPAL }, data: { principal: TO_PRINCIPAL } });
    log(`  employee master updated; contribution rows moved: ${epc.count}.`);

    const old = await tx.teamLeaderAssignment.findFirst({ where: { employeeCode: "PFL033", teamLeaderId: richard.id, principal: FROM_PRINCIPAL } });
    if (!old) throw new Error("PFL033's assignment under Richard / EABL-Nyeri was not found.");
    const clash = await tx.teamLeaderAssignment.findFirst({ where: { employeeCode: "PFL033", teamLeaderId: erick.id, principal: TO_PRINCIPAL } });
    if (clash) throw new Error("PFL033 already has an assignment under Erick / EABL-Nyahururu; resolve by hand.");
    await tx.teamLeaderAssignment.update({
      where: { id: old.id },
      data: { teamLeaderId: erick.id, principal: TO_PRINCIPAL, absolutePrincipal: TO_PRINCIPAL, supervisorId: erickRow?.supervisorId ?? old.supervisorId, managerId: erickRow?.managerId ?? old.managerId, supervisor: "Erick" },
    });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: {
        userEmail: AUDIT_USER,
        action: "UPDATE",
        teamLeaderId: erick.id,
        supervisorId: erickRow?.supervisorId ?? old.supervisorId,
        principal: TO_PRINCIPAL,
        employeeCode: "PFL033",
        changes: { teamLeaderId: { old: richard.id, new: erick.id }, principal: { old: FROM_PRINCIPAL, new: TO_PRINCIPAL } },
      },
    });
    log(`  assignment moved from Richard / ${FROM_PRINCIPAL} to Erick / ${TO_PRINCIPAL}.`);
  }

  log("\n3. Declared contribution % back to 100%");
  await normalizeDeclaredPct(tx, TO_PRINCIPAL);
  await normalizeDeclaredPct(tx, FROM_PRINCIPAL);

  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 120_000, maxWait: 60_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("\nDRY RUN finished and rolled back. Re-run with --apply to commit.");
    return;
  }
  log("\nRecomputing rep contribution, daily targets and employee identities ...");
  await recomputeRosterDerived();
  log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

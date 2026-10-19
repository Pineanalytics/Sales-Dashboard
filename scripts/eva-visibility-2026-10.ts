// One-off (19 Oct 2026): make Eva Gachoki (Sales Supervisor, login egachoki@pinefrost.co.ke) see all four of her principals.
// A Supervisor's dashboard scope is exactly her active Team Leader assignments that carry her Supervisor id (lib/teamLeaderScope.ts), so:
//   1. Bidco-Nairobi: the five reps' assignments had no Supervisor attached, so Bidco was invisible. They get Eva's Supervisor id.
//   2. Milly Fruits-Nairobi: had no assignments at all. The five EFL reps sell it (SAP: Metrine 1111, MaryAnne 1112, Susan 1113, Florence 1114,
//      Venus 1115), so each gets a Milly Fruits-Nairobi assignment under Eva Gachoki, copied from their EFL row (no declared contribution %:
//      the share is computed from sales until one is set).
//   Bennet-Nairobi is not here: its rep (Gray Mwamuye) is not in the employee master yet.
//
//   node --import tsx scripts/eva-visibility-2026-10.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/eva-visibility-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container. One transaction; idempotent.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const AUDIT_USER = "system: eva visibility 2026-10-19";
const MILLY = "Milly Fruits-Nairobi";
const MILLY_REP_CODES = ["1111", "1112", "1113", "1114", "1115"];

async function run(tx: Prisma.TransactionClient) {
  const supervisor = await tx.supervisor.findFirst({ where: { name: "Eva" } });
  const teamLeader = await tx.teamLeader.findFirst({ where: { name: "Eva Gachoki" } });
  if (!supervisor || !teamLeader) throw new Error('Supervisor "Eva" or Team Leader "Eva Gachoki" not found.');

  log("\n1. Attach Eva's Supervisor id to her principals' assignments that have none");
  const unattached = await tx.teamLeaderAssignment.findMany({
    where: { teamLeaderId: teamLeader.id, supervisorId: null, principal: { in: ["Bidco-Nairobi", "EFL-Nairobi", "Bennet-Nairobi", MILLY] } },
    select: { id: true, employeeCode: true, employeeName: true, principal: true, active: true },
  });
  for (const a of unattached) log(`  ${a.principal}  ${a.employeeCode} ${a.employeeName}${a.active ? "" : " (inactive)"}`);
  const updated = await tx.teamLeaderAssignment.updateMany({ where: { id: { in: unattached.map((a) => a.id) } }, data: { supervisorId: supervisor.id } });
  log(`  ${updated.count} assignment(s) updated.`);

  log("\n2. Milly Fruits-Nairobi assignments for the EFL reps");
  let created = 0;
  for (const code of MILLY_REP_CODES) {
    const efl = await tx.teamLeaderAssignment.findFirst({ where: { teamLeaderId: teamLeader.id, employeeCode: code, principal: "EFL-Nairobi", active: true } });
    if (!efl) {
      log(`  !! ${code}: no active EFL-Nairobi assignment under Eva Gachoki; skipped.`);
      continue;
    }
    const exists = await tx.teamLeaderAssignment.findUnique({ where: { teamLeaderId_employeeCode_principal: { teamLeaderId: teamLeader.id, employeeCode: code, principal: MILLY } } });
    if (exists) {
      log(`  = ${code} ${efl.employeeName}: already has a Milly Fruits assignment.`);
      continue;
    }
    await tx.teamLeaderAssignment.create({
      data: {
        teamLeaderId: teamLeader.id,
        employeeCode: code,
        employeeName: efl.employeeName,
        sapName: efl.sapName,
        principal: MILLY,
        active: true,
        salesRole: efl.salesRole,
        region: efl.region,
        subRegion: efl.subRegion,
        workGroup: efl.workGroup,
        company: efl.company,
        absolutePrincipal: MILLY,
        location: efl.location,
        supervisorId: supervisor.id,
        managerId: efl.managerId,
      },
    });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: { userEmail: AUDIT_USER, action: "CREATE", teamLeaderId: teamLeader.id, supervisorId: supervisor.id, principal: MILLY, employeeCode: code, changes: { source: { new: "copied from the rep's EFL-Nairobi assignment" } } },
    });
    created++;
    log(`  + ${code} ${efl.employeeName}`);
  }
  log(`  ${created} assignment(s) created.`);

  const visible = await tx.teamLeaderAssignment.groupBy({ by: ["principal"], where: { supervisorId: supervisor.id, active: true }, _count: { _all: true } });
  log("\n3. Eva's visible principals after this change:");
  for (const v of visible.sort((a, b) => a.principal.localeCompare(b.principal))) log(`  ${v.principal}: ${v._count._all} rep(s)`);

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

// One-off (20 Oct 2026): Isabellah Nderitu (code 1181) sells Suntory under Eve Theuri and Mars under Benson Mbivi.
//   1. Her Mars-Nairobi assignment under Benson Mbivi sits in sub-region "Nairobi Metro"; Benson's Mars team is Nairobi South, so it becomes
//      region Nairobi / sub-region Nairobi South.
//   2. A leftover INACTIVE Mars-Nairobi assignment under Eve Theuri (no region, no contribution, no targets) is removed.
// Her Suntory assignment and her employee-master record are not touched.
//
//   node --import tsx scripts/isabellah-mars-2026-10.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/isabellah-mars-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container. One transaction; idempotent (a second run finds the work done).
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const CODE = "1181";
const PRINCIPAL = "Mars-Nairobi";
const REGION = "Nairobi";
const SUB_REGION = "Nairobi South";
const AUDIT_USER = "system: isabellah mars 2026-10-20";

async function run(tx: Prisma.TransactionClient) {
  const [benson, eve] = await Promise.all([tx.teamLeader.findFirst({ where: { name: "Benson Mbivi" } }), tx.teamLeader.findFirst({ where: { name: "Eve Theuri" } })]);
  if (!benson || !eve) throw new Error("Team Leader Benson Mbivi or Eve Theuri not found.");

  log("\n1. Mars assignment under Benson Mbivi");
  const live = await tx.teamLeaderAssignment.findFirst({ where: { employeeCode: CODE, principal: PRINCIPAL, teamLeaderId: benson.id } });
  if (!live) throw new Error(`No ${PRINCIPAL} assignment for ${CODE} under Benson Mbivi.`);
  if (live.region === REGION && live.subRegion === SUB_REGION) log("  already Nairobi / Nairobi South: nothing to do.");
  else {
    await tx.teamLeaderAssignment.update({ where: { id: live.id }, data: { region: REGION, subRegion: SUB_REGION } });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: {
        userEmail: AUDIT_USER,
        action: "UPDATE",
        teamLeaderId: benson.id,
        supervisorId: live.supervisorId,
        principal: PRINCIPAL,
        employeeCode: CODE,
        changes: { region: { old: live.region, new: REGION }, subRegion: { old: live.subRegion, new: SUB_REGION } },
      },
    });
    log(`  ${live.employeeName}: ${live.region ?? "-"} / ${live.subRegion ?? "-"}  ->  ${REGION} / ${SUB_REGION}`);
  }

  log("\n2. Leftover inactive Mars row under Eve Theuri");
  const leftover = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: CODE, principal: PRINCIPAL, teamLeaderId: eve.id } });
  if (leftover.length === 0) log("  none: nothing to do.");
  for (const row of leftover) {
    if (row.active || row.contributionPct !== null) throw new Error(`Eve Theuri's ${PRINCIPAL} row for ${CODE} is active or carries a contribution: resolve it by hand.`);
    await tx.teamLeaderAssignment.delete({ where: { id: row.id } });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: { userEmail: AUDIT_USER, action: "DELETE", teamLeaderId: eve.id, supervisorId: row.supervisorId, principal: PRINCIPAL, employeeCode: CODE, changes: { removed: { old: "inactive leftover row, no region, no contribution", new: null } } },
    });
    log(`  removed the inactive ${PRINCIPAL} row for ${row.employeeName} under Eve Theuri.`);
  }

  const remaining = await tx.teamLeaderAssignment.findMany({ where: { employeeCode: CODE }, select: { principal: true, active: true, region: true, subRegion: true, teamLeaderId: true } });
  log("\n3. Isabellah's assignments after this change:");
  for (const r of remaining) log(`  ${r.principal} under ${r.teamLeaderId === benson.id ? "Benson Mbivi" : r.teamLeaderId === eve.id ? "Eve Theuri" : r.teamLeaderId}: ${r.active ? "active" : "inactive"}, ${r.region ?? "-"} / ${r.subRegion ?? "-"}`);

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

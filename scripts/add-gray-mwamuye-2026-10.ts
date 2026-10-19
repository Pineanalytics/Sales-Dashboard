// One-off (19 Oct 2026): onboard Gray Mwamuye (code 1236, SAP name "Gray Mwamuye"), the new Bennet-Nairobi rep who sells through the Pine
// system, so Eva Gachoki sees Bennet. Modelled on Ali Binta (1212), the other recent rep under Eva Gachoki: Primary Sales, Nairobi / Nairobi Metro,
// Bennet-Nairobi as his only principal (100% contribution, no declared Team Leader split).
//
//   node --import tsx scripts/add-gray-mwamuye-2026-10.ts            DRY RUN: does everything, prints it, rolls it all back
//   node --import tsx scripts/add-gray-mwamuye-2026-10.ts --apply    the same, committed (then recomputes rep contribution and daily targets)
//
// Run it on the 1 GB sap-sync-worker container. One transaction; idempotent. Region, sub-region and role were not stated by the business and
// follow Eva's other reps; correct them on /admin/team-leaders if Gray sits elsewhere.
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { recomputeRosterDerived } from "../lib/rosterAssignment";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const CODE = "1236";
const NAME = "Gray Mwamuye";
const PRINCIPAL = "Bennet-Nairobi";
const AUDIT_USER = "system: add gray mwamuye 2026-10-19";

async function run(tx: Prisma.TransactionClient) {
  const supervisor = await tx.supervisor.findFirst({ where: { name: "Eva" } });
  const teamLeader = await tx.teamLeader.findFirst({ where: { name: "Eva Gachoki" } });
  if (!supervisor || !teamLeader) throw new Error('Supervisor "Eva" or Team Leader "Eva Gachoki" not found.');
  const principal = await tx.principal.findUnique({ where: { principal: PRINCIPAL }, select: { status: true } });
  if (principal?.status !== "Active") throw new Error(`${PRINCIPAL} is not an Active principal.`);

  const taken = await tx.employeeMaster.findFirst({ where: { OR: [{ employeeCode: CODE }, { sapName: NAME }] }, select: { employeeCode: true, pineName: true } });
  if (taken && taken.employeeCode !== CODE) throw new Error(`The name "${NAME}" is already used by code ${taken.employeeCode} (${taken.pineName}).`);

  log("\n1. Employee master");
  const master = await tx.employeeMaster.upsert({
    where: { employeeCode: CODE },
    update: {},
    create: {
      employeeCode: CODE,
      pineName: NAME,
      sapName: NAME,
      absolutePrincipal: PRINCIPAL,
      salesRole: "Primary Sales",
      teamLeader: teamLeader.name,
      teamLeaderId: teamLeader.id,
      supervisorId: supervisor.id,
      active: true,
    },
  });
  log(taken ? `  ${CODE} ${NAME} already in the employee master.` : `  + ${CODE} ${NAME}, ${PRINCIPAL}, Primary Sales, under ${teamLeader.name}.`);

  log("\n2. Contribution");
  const epc = await tx.employeePrincipalContribution.upsert({
    where: { employeeId_principal: { employeeId: master.id, principal: PRINCIPAL } },
    update: {},
    create: { employeeId: master.id, principal: PRINCIPAL, salesRole: "Primary Sales", contributionPct: 1 },
  });
  log(`  ${PRINCIPAL}: ${(epc.contributionPct * 100).toFixed(0)}%.`);

  log("\n3. Team Leader assignment (what gives Eva visibility)");
  const existing = await tx.teamLeaderAssignment.findUnique({ where: { teamLeaderId_employeeCode_principal: { teamLeaderId: teamLeader.id, employeeCode: CODE, principal: PRINCIPAL } } });
  if (existing) log("  already assigned.");
  else {
    await tx.teamLeaderAssignment.create({
      data: {
        teamLeaderId: teamLeader.id,
        employeeCode: CODE,
        employeeName: NAME,
        sapName: NAME,
        principal: PRINCIPAL,
        absolutePrincipal: PRINCIPAL,
        active: true,
        salesRole: "PRIMARY",
        region: "Nairobi",
        subRegion: "Nairobi Metro",
        supervisorId: supervisor.id,
      },
    });
    await tx.teamLeaderAssignmentAuditLog.create({
      data: { userEmail: AUDIT_USER, action: "CREATE", teamLeaderId: teamLeader.id, supervisorId: supervisor.id, principal: PRINCIPAL, employeeCode: CODE, changes: { employeeName: { new: NAME } } },
    });
    log(`  + ${CODE} ${NAME} under ${teamLeader.name} / ${PRINCIPAL}.`);
  }

  const visible = await tx.teamLeaderAssignment.groupBy({ by: ["principal"], where: { supervisorId: supervisor.id, active: true }, _count: { _all: true } });
  log("\n4. Eva's visible principals after this change:");
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

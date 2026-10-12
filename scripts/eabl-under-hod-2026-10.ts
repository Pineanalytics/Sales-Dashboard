// One-off follow-up to scripts/org-restructure-2026-10.ts: EABL reports straight to its Head of Sales, the way Mars's
// supervisors report to Angela Sitati.
//
//   npx tsx scripts/eabl-under-hod-2026-10.ts            DRY RUN: does everything, prints it, rolls it back
//   npx tsx scripts/eabl-under-hod-2026-10.ts --apply    the same, committed
//
// The first migration created a Sales Supervisor "Alexander Muhoro" between Erick and Richard and the Head of Sales
// Alexander Muhoro, who is the same person. This removes that duplicate and restores the shape Angela's side has:
// Head of Sales Alexander Muhoro -> Erick, Richard and Sarah. Erick and Richard are Sales Supervisor entries under him
// (the tier the roster needs between a Head of Sales and a team leader) and remain the team leaders of Nyahururu and
// Nyeri. Everything that pointed at the duplicate supervisor moves to the right one of the two. One transaction;
// idempotent. Do NOT re-run scripts/org-restructure-2026-10.ts afterwards: its first step would recreate the duplicate.
import { prisma } from "../lib/db";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}
const log = (message: string) => console.log(message);

const HOD_NAME = "Alexander Muhoro";
const DUPLICATE_SUPERVISOR = "Alexander Muhoro";
const LEADERS = ["Erick", "Richard"];

async function run(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const hod = await tx.hod.findUnique({ where: { name: HOD_NAME } });
  if (!hod) throw new Error(`Head of Sales "${HOD_NAME}" not found.`);
  const duplicate = await tx.supervisor.findUnique({ where: { name: DUPLICATE_SUPERVISOR } });

  for (const name of LEADERS) {
    const teamLeader = await tx.teamLeader.findUnique({ where: { name } });
    if (!teamLeader) throw new Error(`Team leader "${name}" not found.`);

    let supervisor = await tx.supervisor.findUnique({ where: { name } });
    if (!supervisor) {
      supervisor = await tx.supervisor.create({ data: { name, directHodId: hod.id } });
      log(`created Sales Supervisor ${name} directly under Head of Sales ${hod.name}.`);
    } else if (supervisor.directHodId !== hod.id) {
      supervisor = await tx.supervisor.update({ where: { id: supervisor.id }, data: { directHodId: hod.id } });
    }

    const leaderRows = await tx.teamLeader.update({ where: { id: teamLeader.id }, data: { supervisorId: supervisor.id } });
    const principals = await tx.principal.updateMany({ where: { teamLeaderId: teamLeader.id }, data: { supervisorId: supervisor.id } });
    const assignments = await tx.teamLeaderAssignment.updateMany({ where: { teamLeaderId: teamLeader.id }, data: { supervisorId: supervisor.id } });
    const employees = await tx.employeeMaster.updateMany({ where: { teamLeaderId: teamLeader.id }, data: { supervisorId: supervisor.id } });
    log(`${leaderRows.name}: ${principals.count} principal row(s), ${assignments.count} assignment(s), ${employees.count} employee row(s) now report to supervisor ${name}.`);
  }

  if (duplicate) {
    const references = {
      teamLeaders: await tx.teamLeader.count({ where: { supervisorId: duplicate.id } }),
      principals: await tx.principal.count({ where: { supervisorId: duplicate.id } }),
      assignments: await tx.teamLeaderAssignment.count({ where: { supervisorId: duplicate.id } }),
      employees: await tx.employeeMaster.count({ where: { supervisorId: duplicate.id } }),
      logins: await tx.user.count({ where: { supervisorId: duplicate.id } }),
    };
    const remaining = Object.entries(references).filter(([, n]) => n > 0);
    if (remaining.length > 0) throw new Error(`Supervisor "${DUPLICATE_SUPERVISOR}" is still referenced (${remaining.map(([k, n]) => `${k}: ${n}`).join(", ")}); not removed and nothing changed.`);
    await tx.supervisor.delete({ where: { id: duplicate.id } });
    log(`removed the duplicate Sales Supervisor "${DUPLICATE_SUPERVISOR}" (the Head of Sales is the same person).`);
  }

  const sarah = await tx.supervisor.findUnique({ where: { name: "Sarah" } });
  const under = await tx.supervisor.findMany({ where: { directHodId: hod.id }, orderBy: { name: "asc" }, select: { name: true } });
  log(`\nUnder Head of Sales ${hod.name} now: ${under.map((s) => s.name).join(", ")}${sarah && sarah.directHodId !== hod.id ? " (Sarah is NOT under him!)" : ""}.`);
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 120_000, maxWait: 30_000 });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    log("\nDRY RUN finished and rolled back. Re-run with --apply to commit.");
    return;
  }
  log("\nCommitted.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

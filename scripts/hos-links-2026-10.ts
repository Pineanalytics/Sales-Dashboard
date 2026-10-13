// One-off: every Sales Supervisor reports to one of the two Heads of Sales (Angela Sitati, Alexander Muhoro).
//
//   npx tsx scripts/hos-links-2026-10.ts            DRY RUN: prints who reports to whom, rolls everything back
//   npx tsx scripts/hos-links-2026-10.ts --apply    the same, committed
//
// The Supervisor table already holds most links (Supervisor.directHodId), but Eva pointed at a "Hod" named Eva Gachoki (a
// supervisor, not a head of sales) and Eve only reached Angela through the Manager table. Both are set directly to
// Angela Sitati here. The Supervisor.managerId links and the Manager and Hod rows are left as they are; nothing is deleted.
// Erick, Richard and Sarah already report to Alexander Muhoro and Emmy, Lucy, Nickley and Truphyline to Angela Sitati.
import { prisma } from "../lib/db";

const apply = process.argv.includes("--apply");
class DryRunRollback extends Error {}

const ANGELA = "Angela Sitati";
const ALEXANDER = "Alexander Muhoro";
// supervisor name -> Head of Sales it must report to
const EXPECTED: Record<string, string> = {
  Emmy: ANGELA,
  Eve: ANGELA,
  Eva: ANGELA,
  Lucy: ANGELA,
  Nickley: ANGELA,
  Truphyline: ANGELA,
  Erick: ALEXANDER,
  Richard: ALEXANDER,
  Sarah: ALEXANDER,
};

const log = (message: string) => console.log(message);

async function run(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const hods = await tx.hod.findMany();
  const hodId = (name: string) => {
    const hod = hods.find((h) => h.name === name);
    if (!hod) throw new Error(`No Head of Sales named "${name}".`);
    return hod.id;
  };
  const supervisors = await tx.supervisor.findMany();
  for (const [name, hodName] of Object.entries(EXPECTED)) {
    const supervisor = supervisors.find((s) => s.name === name);
    if (!supervisor) {
      log(`  ${name}: no such supervisor, skipped.`);
      continue;
    }
    const wanted = hodId(hodName);
    if (supervisor.directHodId === wanted) {
      log(`  ${name}: already reports to ${hodName}.`);
      continue;
    }
    const was = hods.find((h) => h.id === supervisor.directHodId)?.name ?? "nobody";
    await tx.supervisor.update({ where: { id: supervisor.id }, data: { directHodId: wanted } });
    log(`  ${name}: ${was} -> ${hodName}.`);
  }
  const other = supervisors.filter((s) => !(s.name in EXPECTED));
  if (other.length > 0) log(`  Not touched (not in the list): ${other.map((s) => s.name).join(", ")}.`);

  const after = await tx.supervisor.findMany({ orderBy: { name: "asc" } });
  log("\nAfter:");
  for (const hod of hods.filter((h) => after.some((s) => s.directHodId === h.id))) {
    log(`  ${hod.name}: ${after.filter((s) => s.directHodId === hod.id).map((s) => s.name).join(", ")}`);
  }
  const none = after.filter((s) => !s.directHodId);
  if (none.length > 0) log(`  No Head of Sales set: ${none.map((s) => s.name).join(", ")}`);
  if (!apply) throw new DryRunRollback();
}

async function main() {
  log(apply ? "APPLY: changes will be committed." : "DRY RUN: everything is rolled back at the end.");
  try {
    await prisma.$transaction(run, { timeout: 60_000 });
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

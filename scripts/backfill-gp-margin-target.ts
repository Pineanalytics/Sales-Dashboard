import { prisma } from "../lib/db";

/**
 * One-off seed for the new per-principal GP Margin Target field — sets 10%
 * as the starting default on every existing Target row that doesn't already
 * have one. Never overwrites a value an admin already entered; safe to
 * re-run (idempotent, only touches nulls).
 */
async function main() {
  const result = await prisma.target.updateMany({
    where: { grossMarginTargetPct: null },
    data: { grossMarginTargetPct: 0.1 },
  });
  console.log(`Set a 10% GP margin target on ${result.count} Target row(s) that had none.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

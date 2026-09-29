import { prisma } from "../lib/db";

/**
 * One-off correction: the GP margin target policy is a flat 10% for every
 * principal (confirmed directly by the user), and the GP value target is
 * defined as 10% of that principal's own sales (Value) target. One row
 * (Mars-Nairobi, September 2026) had been manually edited to 15% during
 * admin-field testing, which skewed the company-wide blended figure away
 * from the intended flat 10%. This resets every row to the confirmed
 * policy — unlike the original backfill (which only filled nulls), this one
 * unconditionally overwrites grossMarginTargetPct back to 0.10 and
 * (re)computes grossProfitTarget = round(valueTarget * 0.10) wherever a
 * Value Target exists, so both fields agree everywhere. Safe to re-run.
 */
async function main() {
  const rows = await prisma.target.findMany({ select: { id: true, valueTarget: true, grossProfitTarget: true, grossMarginTargetPct: true } });

  let marginFixed = 0;
  let valueFixed = 0;
  for (const row of rows) {
    const data: { grossMarginTargetPct?: number; grossProfitTarget?: number } = {};
    if (row.grossMarginTargetPct !== 0.1) {
      data.grossMarginTargetPct = 0.1;
      marginFixed += 1;
    }
    if (row.valueTarget !== null) {
      const expected = Math.round(row.valueTarget * 0.1);
      if (row.grossProfitTarget !== expected) {
        data.grossProfitTarget = expected;
        valueFixed += 1;
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.target.update({ where: { id: row.id }, data });
    }
  }

  console.log(`Reset grossMarginTargetPct to 10% on ${marginFixed} row(s); recomputed grossProfitTarget (10% of Value Target) on ${valueFixed} row(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

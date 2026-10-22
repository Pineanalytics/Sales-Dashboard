// Fills CoverageDistinctMonthly (customers counted once per month, principal brand and role) from CoverageCustomerActual for every month that has
// customer rows. The Coverage sync keeps it current from then on (app/api/coverage/upload/route.ts), so this only needs to run once after the
// table is created. It reads CoverageCustomerActual and writes only CoverageDistinctMonthly, a disposable derived table; nothing else is touched.
//
//   node --import tsx scripts/backfill-coverage-distinct.ts            DRY RUN: computes every month, prints it, writes nothing
//   node --import tsx scripts/backfill-coverage-distinct.ts --apply    the same, saved (one transaction per month; safe to re-run)
//
// Run it on the 1 GB sap-sync-worker container.
import { prisma } from "../lib/db";
import { computeCoverageDistinct, refreshCoverageDistinctMonth } from "../lib/coverageDistinct";

const apply = process.argv.includes("--apply");

async function main() {
  console.log(apply ? "APPLY: rollups will be saved." : "DRY RUN: nothing is written.");
  const months = await prisma.coverageCustomerActual.groupBy({ by: ["year", "monthIndex"], orderBy: [{ year: "asc" }, { monthIndex: "asc" }] });
  if (months.length === 0) return console.log("No CoverageCustomerActual rows: nothing to do.");

  for (const { year, monthIndex } of months) {
    const customers = await prisma.coverageCustomerActual.findMany({ where: { year, monthIndex }, select: { principal: true, salesRole: true, customerId: true, productiveCalls: true } });
    const rollup = computeCoverageDistinct(year, monthIndex, customers);
    const all = rollup.find((r) => r.principalKey === "*" && r.roleCategory === "*");
    const stored = await prisma.coverageDistinctMonthly.findFirst({ where: { year, monthIndex, principalKey: "*", roleCategory: "*" } });
    console.log(`${year}-${String(monthIndex + 1).padStart(2, "0")}: ${customers.length} customer rows -> ${rollup.length} rollup rows; all principals ${all?.customers ?? 0} customers, ${all?.productiveCustomers ?? 0} productive` + (stored ? ` (stored: ${stored.customers})` : " (not stored yet)"));
    if (apply) await prisma.$transaction((tx) => refreshCoverageDistinctMonth(tx, year, monthIndex), { timeout: 120_000, maxWait: 30_000 });
  }
  console.log(apply ? "Done." : "DRY RUN finished. Re-run with --apply to save.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

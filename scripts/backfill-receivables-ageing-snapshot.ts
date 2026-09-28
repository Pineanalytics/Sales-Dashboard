import { prisma } from "../lib/db";
import { computeAgeingBuckets } from "../lib/receivablesAgeing";
import { getWeeksInMonth } from "../lib/weeklyTargets";

/**
 * One-off seed for the Finance module's "Ageing Trend" tab, run manually once
 * after deploy (not part of the automatic sync pipeline). True historical
 * ageing is unrecoverable — neither our own ReceivableOpenItem mirror nor
 * SAP's own JDT1 source (BalDueDeb/BalDueCred) retains a past balance trail,
 * only the current live residual. This instead reconstructs an approximate
 * trail by re-ageing TODAY's still-open items as of every past date since
 * January 1st of the current year, and marks every row isApproximate: true so
 * the UI can label it. It never overwrites a real (post-deploy sync) snapshot.
 */
async function main() {
  const openItems = await prisma.receivableOpenItem.findMany({ select: { dueDate: true, openBalance: true } });
  if (openItems.length === 0) {
    console.log("No open items to backfill from — run this after the first real receivables sync.");
    return;
  }

  // Every already-elapsed calendar week from January through the current
  // month — this matches getAgeingSnapshotForMonth's own weekly resolution
  // exactly, for whichever month a viewer later selects in the Ageing Trend
  // tab, not just the current one.
  const now = new Date();
  const dates = new Set<number>();
  for (let m = 0; m <= now.getUTCMonth(); m += 1) {
    for (const week of getWeeksInMonth(now.getUTCFullYear(), m)) {
      const weekEnd = new Date(week.weekStartDate.getTime() + 6 * 86_400_000);
      if (weekEnd.getTime() <= now.getTime()) dates.add(Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth(), weekEnd.getUTCDate()));
    }
  }

  const existing = await prisma.receivablesAgeingSnapshot.findMany({ select: { snapshotDate: true } });
  const existingTimes = new Set(existing.map((row) => row.snapshotDate.getTime()));

  let created = 0;
  for (const time of Array.from(dates).sort((a, b) => a - b)) {
    if (existingTimes.has(time)) continue; // never overwrite a real snapshot
    const asOf = new Date(time);
    if (asOf.getTime() > now.getTime()) continue;
    const buckets = computeAgeingBuckets(openItems, asOf);
    await prisma.receivablesAgeingSnapshot.create({ data: { snapshotDate: asOf, ...buckets, isApproximate: true } });
    created += 1;
  }

  console.log(`Backfilled ${created} approximate ageing snapshot(s) from January to ${now.toISOString().slice(0, 10)}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

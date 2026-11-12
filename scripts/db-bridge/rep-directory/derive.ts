// Derived rep directory: Leverage, Upfield DataEdge and EABL DMS have no rep table, so their reps are taken from the sales,
// visit and call rows already stored in Postgres. No external system is contacted. Run with: npm run rep-directory:derive (add -- --dry-run to read and report without writing)
process.loadEnvFile();

import { prisma } from "../../../lib/db";
import { deriveDataEdgeEntries, deriveEablEntries, deriveLeverageEntries } from "../../../lib/repDirectoryBuild";
import { syncRepDirectory } from "../../../lib/repDirectory";

async function main() {
  const now = new Date();
  const failures: string[] = [];
  const dryRun = process.argv.includes("--dry-run");
  const sync: typeof syncRepDirectory = async (source, entries, at) => {
    if (dryRun) {
      console.log(`[rep-directory:derive] DRY RUN ${source}: ${entries.length} entries, ${entries.filter((e) => e.isActive).length} active, ${entries.filter((e) => e.loginName).length} with a login. Nothing written.`);
      return { created: 0, updated: 0, deactivated: 0, unchanged: 0 };
    }
    return syncRepDirectory(source, entries, at);
  };

  async function step(label: string, run: () => Promise<{ created: number; updated: number; deactivated: number; unchanged: number }>) {
    try {
      const r = await run();
      console.log(`[rep-directory:derive] ${label}: ${r.created} added, ${r.updated} updated, ${r.deactivated} marked inactive, ${r.unchanged} unchanged.`);
    } catch (error) {
      // One source with no rows yet must not block the others.
      failures.push(label);
      console.error(`[rep-directory:derive] ${label} failed:`, error instanceof Error ? error.message : error);
    }
  }

  await step("Leverage", async () => {
    const groups = await prisma.salesReturnLine.groupBy({ by: ["storageLocation", "salesRepCode", "salesRepName"], _max: { deliveryDate: true } });
    return sync("LEVERAGE", deriveLeverageEntries(groups.map((g) => ({ branch: g.storageLocation, repCode: g.salesRepCode, repName: g.salesRepName, lastDate: g._max.deliveryDate })), now), now);
  });

  await step("Upfield DataEdge", async () => {
    const [transactions, visits, logins] = await Promise.all([
      prisma.upfieldTransaction.groupBy({ by: ["fsr"], _max: { txnDate: true } }),
      prisma.upfieldVisit.groupBy({ by: ["fsr"], _max: { startTime: true } }),
      prisma.upfieldOutletMaster.findMany({ where: { fsrLogin: { not: null } }, select: { fsrName: true, fsrLogin: true }, distinct: ["fsrName", "fsrLogin"] }),
    ]);
    return sync(
      "DATAEDGE",
      deriveDataEdgeEntries(
        transactions.map((t) => ({ fsr: t.fsr, lastDate: t._max.txnDate })),
        visits.map((v) => ({ fsr: v.fsr, lastDate: v._max.startTime })),
        logins,
        now
      ),
      now
    );
  });

  await step("EABL DMS", async () => {
    const groups = await prisma.eablCall.groupBy({ by: ["salesman"], _max: { callDate: true } });
    return sync("EABL_DMS", deriveEablEntries(groups.map((g) => ({ salesman: g.salesman, lastDate: g._max.callDate })), now), now);
  });

  if (failures.length > 0) throw new Error(`Failed for: ${failures.join(", ")}`);
}

main()
  .catch((error) => {
    console.error("[rep-directory:derive] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

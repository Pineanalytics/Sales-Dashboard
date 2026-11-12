// SAP rep sync: reads the whole salesperson master (OSLP) and refreshes the rep directory's SAP rows.
// Read-only against SAP. It selects only the code, name, status and the three user fields that say where the rep sells;
// OSLP's phone and email columns are never read. Run with: npm run rep-directory:sap (add -- --dry-run to read and report without writing)
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "../sql";
import { prisma } from "../../../lib/db";
import { buildSapEntries, type SapSalespersonRow } from "../../../lib/repDirectoryBuild";
import { syncRepDirectory } from "../../../lib/repDirectory";

async function main() {
  const rows = await withConnection(loadConfigFromEnv(), async (pool) => {
    const result = await pool.request().query<{
      SlpCode: number;
      SlpName: string | null;
      Active: string | null;
      Locked: string | null;
      U_Principle: string | null;
      U_Branch: string | null;
      U_SalesUnit: string | null;
    }>(`
      SELECT T0.SlpCode, T0.SlpName, T0.Active, T0.Locked, T0.U_Principle, T0.U_Branch, T0.U_SalesUnit
      FROM OSLP T0
      WHERE T0.SlpName IS NOT NULL AND LTRIM(RTRIM(T0.SlpName)) <> ''
    `);
    return result.recordset.map<SapSalespersonRow>((r) => ({
      slpCode: r.SlpCode,
      slpName: r.SlpName,
      active: r.Active,
      locked: r.Locked,
      principal: r.U_Principle,
      branch: r.U_Branch,
      salesUnit: r.U_SalesUnit,
    }));
  });
  console.log(`[rep-directory:sap] ${rows.length} salespeople read from OSLP.`);

  // Last activity comes from the sales documents the SFA sync already stored, so no SAP invoice scan is needed.
  const activity = await prisma.salesDocument.groupBy({ by: ["slpCode"], _max: { docDate: true } });
  const lastActivity = new Map<number, Date>();
  for (const row of activity) if (row._max.docDate) lastActivity.set(row.slpCode, row._max.docDate);

  const entries = buildSapEntries(rows, lastActivity);
  if (process.argv.includes("--dry-run")) {
    console.log(`[rep-directory:sap] DRY RUN, nothing written: ${entries.length} entries, ${entries.filter((e) => e.isActive).length} active, ${entries.filter((e) => e.isFieldRep).length} field reps, ${entries.filter((e) => e.lastActivityAt).length} with stored activity, ${entries.filter((e) => e.principalHint).length} with a principal hint.`);
    return;
  }
  const result = await syncRepDirectory("SAP", entries);
  console.log(`[rep-directory:sap] ${result.created} added, ${result.updated} updated, ${result.deactivated} marked inactive, ${result.unchanged} unchanged.`);
}

main()
  .catch((error) => {
    console.error("[rep-directory:sap] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

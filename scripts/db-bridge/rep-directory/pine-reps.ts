// Pine rep sync: reads Pine's user list and refreshes the rep directory's Pine rows. Read-only.
// pine.users also holds password hashes, salts, one-time codes and API keys, so the query (PINE_USERS_QUERY) names the six columns
// it needs and never selects *. Run with: npm run rep-directory:pine (add -- --dry-run to read and report without writing)
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";
import { prisma } from "../../../lib/db";
import { buildPineEntries, PINE_USERS_QUERY, type PineUserRow } from "../../../lib/repDirectoryBuild";
import { syncRepDirectory } from "../../../lib/repDirectory";

async function main() {
  const rows = await withCoverageConnection(loadCoverageConfigFromEnv(), async (conn) => {
    const [result] = await conn.query(PINE_USERS_QUERY);
    return (result as Array<{ id: number; first_name: string | null; last_name: string | null; salesgroup: string | null; region: string | null; active: number | null }>).map<PineUserRow>((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      salesGroup: r.salesgroup,
      region: r.region,
      active: r.active,
    }));
  });
  console.log(`[rep-directory:pine] ${rows.length} users read from pine.users.`);

  // Last activity: the latest call the Timestamps sync stored for that Pine user id (the roster's employee code).
  const activity = await prisma.repCall.groupBy({ by: ["employeeCode"], _max: { date: true } });
  const lastActivity = new Map<string, Date>();
  for (const row of activity) if (row._max.date) lastActivity.set(row.employeeCode, row._max.date);

  const entries = buildPineEntries(rows, lastActivity);
  if (process.argv.includes("--dry-run")) {
    console.log(`[rep-directory:pine] DRY RUN, nothing written: ${entries.length} entries, ${entries.filter((e) => e.isActive).length} active, ${entries.filter((e) => e.isFieldRep).length} field reps, ${entries.filter((e) => e.isActive && e.isFieldRep).length} active field reps, ${entries.filter((e) => e.lastActivityAt).length} with stored activity.`);
    return;
  }
  const result = await syncRepDirectory("PINE", entries);
  console.log(`[rep-directory:pine] ${result.created} added, ${result.updated} updated, ${result.deactivated} marked inactive, ${result.unchanged} unchanged.`);
}

main()
  .catch((error) => {
    console.error("[rep-directory:pine] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

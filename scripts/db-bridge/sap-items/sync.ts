// SAP item master sync: reads every SAP item (OITM with item group, manufacturer, preferred vendor and the Selling / Purchase prices) and
// replaces the dashboard's SapItem mirror in one transaction, so a reader never sees a half-written table. Read-only against SAP; touches
// only SapItem. Run by the sap-sync-worker (sap-items job, every 30 minutes) or by hand:
//
//   npm run sap-items:sync                 read and replace
//   npm run sap-items:sync -- --dry-run    read and report, write nothing
try {
  process.loadEnvFile(process.env.SAP_ITEMS_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { prisma } from "../../../lib/db";
import { buildSapItems } from "../../../lib/sapItemMaster";
import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchItemMaster } from "../queries/itemMaster";

const CHUNK = 1000;

async function main() {
  const started = Date.now();
  const rows = await withConnection(loadConfigFromEnv(), fetchItemMaster);
  const items = buildSapItems(rows, new Date());
  const withSupplier = items.filter((item) => item.preferredSupplierCode).length;
  const active = items.filter((item) => item.active !== false && item.frozen !== true).length;
  console.log(`[sap-items] ${rows.length} rows read from SAP: ${items.length} items, ${active} active, ${withSupplier} with a preferred supplier (OITM.CardCode).`);

  if (process.argv.includes("--dry-run")) {
    console.log("[sap-items] DRY RUN, nothing written.");
    return;
  }
  if (items.length === 0) throw new Error("SAP returned no items; keeping the existing SapItem rows.");

  await prisma.$transaction(
    async (tx) => {
      await tx.sapItem.deleteMany({});
      for (let i = 0; i < items.length; i += CHUNK) await tx.sapItem.createMany({ data: items.slice(i, i + CHUNK) });
    },
    { timeout: 120_000 }
  );
  console.log(`[sap-items] SapItem replaced with ${items.length} items in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((error) => {
    console.error("[sap-items] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

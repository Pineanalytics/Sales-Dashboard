// Entry point for the shadow-validation SQL bridge. Read-only end to end: queries
// are SELECT-only (scripts/db-bridge/sql.ts enforces this by construction), and the
// only write this script performs is a local JSON file under output/ (gitignored).
// Never touches Prisma/Postgres, never calls any app API, never modifies the
// production upload path. Run with: npm run db-bridge:run
process.loadEnvFile();

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchYtdRaw } from "./queries/ytdRaw";
import { fetchStockBalance } from "./queries/stockBalance";
import { fetchRepList } from "./queries/repList";
import { loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildMonthlySales } from "./transform/buildMonthlySales";
import { buildStock } from "./transform/buildStock";
import principalsData from "./reference/principals.json";

async function main() {
  const config = loadConfigFromEnv();

  const asOfDate = new Date();
  console.log(`[db-bridge] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)})...`);

  const [{ ytdRows, stockRows, repList }, products, warehousesData] = await Promise.all([
    withConnection(config, async (pool) => {
      const [ytdRows, stockRows, repList] = await Promise.all([
        fetchYtdRaw(pool, asOfDate),
        fetchStockBalance(pool, asOfDate),
        fetchRepList(pool),
      ]);
      return { ytdRows, stockRows, repList };
    }),
    loadProducts(),
    loadWarehouses(),
  ]);
  console.log(`[db-bridge] Fetched ${ytdRows.length} YTD_Raw rows, ${stockRows.length} Stock_Balance rows, ${repList.length} reps.`);
  console.log(`[db-bridge] Loaded ${products.length} product rows and ${warehousesData.length} warehouse rows from Postgres.`);

  const monthlySales = buildMonthlySales(ytdRows, products, warehousesData, principalsData);
  const { items: stockItems } = buildStock(stockRows, products, warehousesData, principalsData);
  console.log(`[db-bridge] Built ${monthlySales.length} monthly-sales rows and ${stockItems.length} stock rows.`);

  const outputDir = join(import.meta.dirname, "output");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const timestamp = asOfDate.toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDir, `bridge-output-${timestamp}.json`);
  writeFileSync(
    outputPath,
    JSON.stringify({ generatedAt: asOfDate.toISOString(), monthlySales, stockItems, repList }, null, 2)
  );

  console.log(`[db-bridge] Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error("[db-bridge] FAILED:", err);
  process.exitCode = 1;
});

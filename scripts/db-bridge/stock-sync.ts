// Live direct SAP stock bridge. It runs separately from sales-sync because the
// year-to-date demand aggregation is intentionally heavier; a stock delay must
// never delay the 30-minute sales refresh. Excel remains the visible fallback
// while /admin/dataset compares every completed SAP snapshot against it.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchStockBalance } from "./queries/stockBalance";
import { fetchStandardStockDemand } from "./queries/standardStock";
import { loadPrincipals, loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildDirectStock } from "./transform/buildDirectStock";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

async function main() {
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const asOfDate = new Date();
  const yearStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1));

  console.log(`[stock-sync] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)})...`);
  const [{ stockRows, demandRows }, products, warehouses, principals] = await Promise.all([
    withConnection(config, async (pool) => {
      const [stockRows, demandRows] = await Promise.all([
        fetchStockBalance(pool, asOfDate),
        fetchStandardStockDemand(pool, yearStart, asOfDate),
      ]);
      return { stockRows, demandRows };
    }),
    loadProducts(),
    loadWarehouses(),
    loadPrincipals(),
  ]);

  const result = buildDirectStock(stockRows, demandRows, products, warehouses, principals, asOfDate);
  if (result.items.length === 0) throw new Error("Direct SAP stock build produced zero dashboard rows; preserving the prior snapshot.");
  console.log(`[stock-sync] Built ${result.items.length} principal-item rows from ${stockRows.length} balance and ${demandRows.length} demand rows.`);

  const response = await fetch(`${appUrl}/api/stock/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({
      sourceDate: asOfDate.toISOString().slice(0, 10),
      rows: result.items.map(({ key: _key, ...row }) => row),
      physicalSourceRows: stockRows.length,
      demandSourceRows: demandRows.length,
      matchedDemandRows: result.matchedDemandRows,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  console.log(`[stock-sync] Uploaded ${body.count} rows. Comparison: ${body.comparison.matchedRows}/${body.comparison.excelRows ?? "no Excel snapshot"} matched.`);
}

main().catch((error) => {
  console.error("[stock-sync] FAILED:", error);
  process.exitCode = 1;
});

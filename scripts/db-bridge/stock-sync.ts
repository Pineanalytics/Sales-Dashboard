// Live direct SAP stock bridge. It runs separately from sales-sync because the
// year-to-date demand aggregation is intentionally heavier; a stock delay must
// never delay the 30-minute sales refresh. Excel remains the visible fallback
// while /admin/dataset compares every completed SAP snapshot against it.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchStockBalance } from "./queries/stockBalance";
import { fetchRecentActiveSales, fetchStandardStockDemand } from "./queries/standardStock";
import { loadPrincipals, loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildDirectStock } from "./transform/buildDirectStock";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

function isNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function main() {
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const asOfDate = new Date();
  const yearStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1));
  const activeSalesStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() - 3, asOfDate.getUTCDate()));

  console.log(`[stock-sync] Connecting to ${config.server}/${config.database} (as of ${asOfDate.toISOString().slice(0, 10)})...`);
  const [{ stockRows, demandRows, recentSalesRows }, products, warehouses, principals] = await Promise.all([
    withConnection(config, async (pool) => {
      const [stockRows, demandRows, recentSalesRows] = await Promise.all([
        fetchStockBalance(pool, asOfDate),
        fetchStandardStockDemand(pool, yearStart, asOfDate),
        fetchRecentActiveSales(pool, activeSalesStart, asOfDate),
      ]);
      return { stockRows, demandRows, recentSalesRows };
    }),
    loadProducts(),
    loadWarehouses(),
    loadPrincipals(),
  ]);

  const result = buildDirectStock(stockRows, demandRows, recentSalesRows, products, warehouses, principals, asOfDate);
  if (result.items.length === 0) throw new Error("Direct SAP stock build produced zero dashboard rows; preserving the prior snapshot.");
  console.log(`[stock-sync] Built ${result.items.length} operational and ${result.dormantItems.length} dormant out-of-stock rows from ${stockRows.length} balance and ${demandRows.length} demand rows.`);

  const invalidOperationalRow = result.items.find((row) =>
    !isNonBlankText(row.itemCode) || !isNonBlankText(row.principal) || !isNonBlankText(row.item) || !isNonBlankText(row.action)
    || !isFiniteNumber(row.openingVolume) || !isFiniteNumber(row.openingPcs) || !isFiniteNumber(row.openingValue)
    || !isFiniteNumber(row.rrWeekValue) || !isFiniteNumber(row.rrWeekVolume) || !isFiniteNumber(row.daysCover)
  );
  const invalidDormantRow = result.dormantItems.find((row) =>
    !isNonBlankText(row.itemCode) || !isNonBlankText(row.principal) || !isNonBlankText(row.item)
    || !isFiniteNumber(row.openingPcs) || !isFiniteNumber(row.openingValue)
    || (row.lastSaleDate !== null && Number.isNaN(row.lastSaleDate.getTime()))
  );
  if (invalidOperationalRow || invalidDormantRow) {
    const invalid = invalidOperationalRow ?? invalidDormantRow;
    throw new Error(`[stock-sync] Refusing invalid SAP stock row before upload: ${JSON.stringify(invalid)}`);
  }

  const response = await fetch(`${appUrl}/api/stock/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({
      sourceDate: asOfDate.toISOString().slice(0, 10),
      rows: result.items.map((item) => ({
        itemCode: item.itemCode,
        principal: item.principal,
        item: item.item,
        openingVolume: item.openingVolume,
        openingPcs: item.openingPcs,
        openingValue: item.openingValue,
        rrWeekValue: item.rrWeekValue,
        rrWeekVolume: item.rrWeekVolume,
        daysCover: item.daysCover,
        action: item.action,
      })),
      dormantRows: result.dormantItems.map((row) => ({ ...row, lastSaleDate: row.lastSaleDate?.toISOString().slice(0, 10) ?? null })),
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

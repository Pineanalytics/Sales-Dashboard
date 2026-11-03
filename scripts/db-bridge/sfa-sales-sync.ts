// SFA-outlet-grain SAP sales sync. A separate, additive job: it never touches the
// existing sales tables or sales-sync.ts. It reads document-level SAP lines one
// month at a time, builds SalesDocument + SfaCustomerActual, and pushes them to
// /api/sales/upload-sfa in small idempotent chunks followed by a per-month
// finalize that prunes rows left over from older runs. The per-month work lives in
// sfa/syncMonth.ts, which brand-customer-sync.ts also uses so one refresh can do both.
//
//   npm run sfa-sales:sync                          current month
//   npm run sfa-sales:sync -- --months=2            current + previous month
//   npm run sfa-sales:sync -- --backfill            1 Jan of the current year to now
//   npm run sfa-sales:sync -- --from=2026-01 --to=2026-06
//   npm run sfa-sales:sync -- --dry-run [...]       read + build + reconcile, upload nothing
//
// Also run hourly for the last 2 months by the sap-sync-worker.
try {
  process.loadEnvFile(process.env.SFA_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { loadConfigFromEnv } from "./sql";
import { loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { sfaMonthLabel, syncSfaMonth, type SfaMonth } from "./sfa/syncMonth";
import type { ProductRow } from "./reference/loadFromDb";
import type { WarehouseRow } from "./transform/buildMonthlySales";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

function monthRange(asOf: Date): SfaMonth[] {
  const current: SfaMonth = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  const parse = (value: string): SfaMonth => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Expected YYYY-MM, got "${value}".`);
    return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
  };
  let start = current;
  let end = current;
  if (flag("backfill")) start = { year: current.year, monthIndex: 0 };
  else if (option("months")) {
    const count = Number(option("months"));
    if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--months must be 1-24.");
    const d = new Date(Date.UTC(current.year, current.monthIndex - (count - 1), 1));
    start = { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
  }
  if (option("from")) start = parse(option("from")!);
  if (option("to")) end = parse(option("to")!);

  const months: SfaMonth[] = [];
  let y = start.year;
  let m = start.monthIndex;
  while (y < end.year || (y === end.year && m <= end.monthIndex)) {
    months.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}

async function main() {
  const dryRun = flag("dry-run");
  const asOf = new Date();
  const months = monthRange(asOf);
  const config = loadConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY ?? "";
  if (!dryRun && !apiKey) throw new Error("Missing UPLOAD_API_KEY — set it in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  let products: ProductRow[] = [];
  let warehouses: WarehouseRow[] = [];
  try {
    [products, warehouses] = await Promise.all([loadProducts(), loadWarehouses()]);
  } catch (err) {
    if (!dryRun) throw err;
    console.warn("[sfa-sales-sync] Product Master unreachable — dry run falls back to prefix rules only (PRODUCT source will read 0).");
  }

  console.log(`[sfa-sales-sync] ${dryRun ? "DRY RUN " : ""}${months.map(sfaMonthLabel).join(", ")} against ${config.server}/${config.database}; ${products.length} products, ${warehouses.length} warehouses.`);
  for (const month of months) await syncSfaMonth({ config, appUrl, apiKey, month, asOf, products, warehouses, dryRun });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[sfa-sales-sync] FAILED:", err);
    process.exit(1);
  });

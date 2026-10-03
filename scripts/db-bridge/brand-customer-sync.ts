// Dedicated, memory-bounded refresh of the Customer & Brands tables
// (BrandCustomerActual month grain, DailyBrandCustomerActual day grain).
//
// sales-sync.ts --backfill builds ~735k customer rows in one process and posts
// them in ONE request / ONE transaction; inside the 1 GiB sap-sync-worker it
// runs out of memory before that last upload finishes. This job reads SAP one
// calendar month at a time and uploads each month as its own small request, so
// peak memory is a single month and a failure only affects that month.
//
// It uses the same queries, the same builders (buildMonthlyCustomerSales /
// buildDailyCustomerSales) and the same /api/sales/upload-brand-customer route
// (whose per-request delete-then-insert replacement is atomic) as
// sales-sync.ts, so the result is identical to a successful full backfill. It
// touches only the two customer/brand tables: principal, daily, rep and
// unmapped-product data and the derived target tables are not changed.
//
//   npm run brand-customer:sync                       current month
//   npm run brand-customer:sync -- --months=3         current + 2 previous months
//   npm run brand-customer:sync -- --backfill         Jan of last year to now
//                                                     (day grain: current year only)
//   npm run brand-customer:sync -- --from=2026-01 --to=2026-08
//   npm run brand-customer:sync -- --dry-run [...]    read + build, upload nothing
//
// Not scheduled. Run by hand, e.g. inside the sap-sync-worker container.
try {
  process.loadEnvFile(process.env.BRAND_CUSTOMER_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { loadConfigFromEnv, withConnection } from "./sql";
import { fetchYtdRaw } from "./queries/ytdRaw";
import { fetchDailySalesRaw } from "./queries/dailySalesRaw";
import { loadPrincipals, loadProducts, loadWarehouses } from "./reference/loadFromDb";
import { buildDailyCustomerSales, buildMonthlyCustomerSales } from "./transform/buildRepSales";
import { groupByMonth, monthRange, parseMonthArg, planMonthReads, trailingMonths, type TargetMonth } from "./transform/brandCustomerBatches";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const MAX_ATTEMPTS = 3;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

function selectTargets(asOf: Date): TargetMonth[] {
  const current: TargetMonth = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  if (flag("backfill")) return monthRange({ year: current.year - 1, monthIndex: 0 }, current);
  const from = parseMonthArg(option("from"));
  if (from) return monthRange(from, parseMonthArg(option("to")) ?? current);
  if (option("from") || option("to")) throw new Error("--from and --to must look like 2026-01.");
  const months = option("months");
  const count = months === undefined ? 1 : Number(months);
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--months must be a whole number from 1 to 24.");
  return trailingMonths(asOf, count);
}

async function post(appUrl: string, apiKey: string, label: string, body: unknown): Promise<{ monthlyRows: number; dailyRows: number }> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/sales/upload-brand-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) return JSON.parse(text);
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      if (response.status >= 400 && response.status < 500) break; // a rejected payload will not improve on retry
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < MAX_ATTEMPTS) {
      console.error(`[brand-customer] ${label}: attempt ${attempt} failed (${lastError}); retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
  throw new Error(`${label}: ${lastError}`);
}

async function main() {
  const config = loadConfigFromEnv();
  const dryRun = flag("dry-run");
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey && !dryRun) throw new Error("Missing UPLOAD_API_KEY.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const asOf = new Date();
  const asOfYear = asOf.getUTCFullYear();
  const targets = selectTargets(asOf);
  const reads = planMonthReads(targets, asOfYear);
  const skipped = targets.filter((t) => t.year !== asOfYear && t.year !== asOfYear - 1);
  if (skipped.length > 0) console.log(`[brand-customer] Ignoring ${skipped.length} month(s) outside ${asOfYear - 1}-${asOfYear}.`);
  console.log(
    `[brand-customer] ${dryRun ? "DRY RUN - " : ""}${targets.length} target month(s) from ${config.server}/${config.database}, ${reads.length} SAP read(s), one upload per month.`
  );

  const [products, warehouses, principals] = await Promise.all([loadProducts(), loadWarehouses(), loadPrincipals()]);
  const failures: string[] = [];
  const wanted = new Set(targets.map((t) => `${t.year}|${t.monthIndex}`));

  for (const read of reads) {
    // Monthly grain. The YTD_Raw read returns this month for the as-of year and
    // the year before; keep only the years that were asked for.
    try {
      const ytdRows = (await withConnection(config, (pool) => fetchYtdRaw(pool, asOf, { start: read.start, end: read.end }))).filter((row) =>
        wanted.has(`${row.year}|${row.monthNo - 1}`)
      );
      const monthly = buildMonthlyCustomerSales(ytdRows, products, warehouses, principals);
      for (const { period, rows } of groupByMonth(monthly, (row) => ({ year: Number(row.year), monthIndex: row.monthIndex })).values()) {
        const label = `${period.year}-${String(period.monthIndex + 1).padStart(2, "0")} monthly`;
        const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
        if (dryRun) {
          console.log(`[brand-customer] ${label}: ${rows.length} rows, revenue ${Math.round(revenue)} (not uploaded)`);
          continue;
        }
        const saved = await post(appUrl, apiKey!, label, {
          monthlyRows: rows,
          dailyRows: [],
          monthlyReplacePeriods: [{ year: String(period.year), monthIndex: period.monthIndex }],
        }).catch((error: Error) => {
          failures.push(error.message);
          console.error(`[brand-customer] FAILED ${error.message}`);
          return null;
        });
        if (saved) console.log(`[brand-customer] ${label}: saved ${saved.monthlyRows} rows, revenue ${Math.round(revenue)}.`);
      }
    } catch (error) {
      const message = `${read.start.slice(0, 7)} monthly read: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(message);
      console.error(`[brand-customer] FAILED ${message}`);
    }

    // Day grain is kept for the as-of year only, as in sales-sync.ts.
    if (!read.years.includes(asOfYear)) continue;
    try {
      const start = new Date(`${read.start}T00:00:00Z`);
      const end = new Date(Math.min(new Date(`${read.end}T00:00:00Z`).getTime(), asOf.getTime()));
      if (start > end) continue; // a month that has not started yet
      const dailyRaw = await withConnection(config, (pool) => fetchDailySalesRaw(pool, start, end));
      const daily = buildDailyCustomerSales(dailyRaw, products, warehouses, principals);
      const label = `${read.start.slice(0, 7)} daily`;
      const revenue = daily.reduce((sum, row) => sum + row.revenue, 0);
      if (dryRun) {
        console.log(`[brand-customer] ${label}: ${daily.length} rows, revenue ${Math.round(revenue)} (not uploaded)`);
        continue;
      }
      const saved = await post(appUrl, apiKey!, label, {
        monthlyRows: [],
        dailyRows: daily,
        dailyReplacePeriods: [{ year: String(asOfYear), monthIndex: read.monthIndex }],
      }).catch((error: Error) => {
        failures.push(error.message);
        console.error(`[brand-customer] FAILED ${error.message}`);
        return null;
      });
      if (saved) console.log(`[brand-customer] ${label}: saved ${saved.dailyRows} rows, revenue ${Math.round(revenue)}.`);
    } catch (error) {
      const message = `${read.start.slice(0, 7)} daily read: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(message);
      console.error(`[brand-customer] FAILED ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`[brand-customer] Finished with ${failures.length} failed batch(es); the other months were saved. Re-run for the failed months:\n  - ${failures.join("\n  - ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[brand-customer] ${dryRun ? "Dry run complete." : "Done - every month saved."}`);
}

main().catch((err) => {
  console.error("[brand-customer] FAILED:", err);
  process.exitCode = 1;
});

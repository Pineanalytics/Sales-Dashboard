// Performance Analysis refresh: reads the year's SAP invoice and credit-note
// lines one calendar month at a time (peak SAP/memory load is one month), builds
// the report for both gross-profit measures, and replaces the stored snapshot
// through /api/performance-analysis/upload. Memory-bounded the same way
// brand-customer-sync.ts is: raw rows are reduced to compact lines as each month
// is read, and only the small aggregate is ever sent.
//
// A failed month read aborts the run and leaves the previous snapshot in place:
// a report built from a partial year would be wrong, not just stale.
//
//   npm run performance:sync                 current year, upload the snapshot
//   npm run performance:sync -- --dry-run    read + build + tie-out, upload nothing
//   npm run performance:sync -- --json=out.json   also write the snapshot to a file
//
// Scheduled daily by scripts/continuous-sync-worker.ts (job "performance").
try {
  process.loadEnvFile(process.env.PERFORMANCE_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { aggregatePerformance } from "@/lib/performanceAnalysis/aggregate";
import type { PerfLine, PerformanceSnapshotPayload } from "@/lib/performanceAnalysis/types";
import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchPerformanceLines } from "../queries/performanceLines";
import { loadPrincipals, loadProducts, loadWarehouses } from "../reference/loadFromDb";
import { buildPerformanceLines, holdClosedMonthGp, storedTotalsKey, type StoredMonthTotals } from "../transform/buildPerformanceLines";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const MAX_ATTEMPTS = 3;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

/** The Nairobi calendar date (YYYY-MM-DD) of `instant`. */
function nairobiDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

async function post(appUrl: string, apiKey: string, year: number, snapshot: PerformanceSnapshotPayload): Promise<void> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/performance-analysis/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
        body: JSON.stringify({ year, snapshot }),
      });
      const text = await response.text();
      if (response.ok) return;
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      if (response.status >= 400 && response.status < 500) break; // a rejected payload will not improve on retry
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < MAX_ATTEMPTS) {
      console.error(`[performance] upload attempt ${attempt} failed (${lastError}); retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
  throw new Error(`upload failed: ${lastError}`);
}

async function main() {
  const config = loadConfigFromEnv();
  const dryRun = flag("dry-run");
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey && !dryRun) throw new Error("Missing UPLOAD_API_KEY.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  const asOf = nairobiDate(new Date());
  const year = Number(option("year") ?? asOf.slice(0, 4));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("--year must be a calendar year.");
  const lastMonthNo = year === Number(asOf.slice(0, 4)) ? Number(asOf.slice(5, 7)) : 12;
  const asOfMonth = `${asOf.slice(0, 4)}-${asOf.slice(5, 7)}`;
  console.log(`[performance] ${dryRun ? "DRY RUN - " : ""}${year}: ${lastMonthNo} month(s) from ${config.server}/${config.database}, as of ${asOf}.`);

  const [products, warehouses, principals] = await Promise.all([loadProducts(), loadWarehouses(), loadPrincipals()]);

  const lines: PerfLine[] = [];
  const salesRecordKeys: string[] = [];
  let excludedSales = 0;
  let excludedLines = 0;
  const readSales = new Map<string, number>();

  for (let monthNo = 1; monthNo <= lastMonthNo; monthNo += 1) {
    const mm = String(monthNo).padStart(2, "0");
    const last = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
    const rows = await withConnection(config, (pool) => fetchPerformanceLines(pool, `${year}-${mm}-01`, `${year}-${mm}-${String(last).padStart(2, "0")}`));
    const built = buildPerformanceLines(rows, products, warehouses, principals);
    for (const line of built.lines) lines.push(line);
    for (const key of built.salesRecordKeys) salesRecordKeys.push(key);
    excludedSales += built.excludedSales;
    excludedLines += built.excludedLines;
    readSales.set(`${year}-${mm}`, built.lines.reduce((sum, line) => sum + line.sales, 0));
    console.log(`[performance] ${year}-${mm}: ${rows.length} SAP lines, ${built.lines.length} kept, sales ${Math.round(readSales.get(`${year}-${mm}`)!)}.`);
  }

  // Closed months keep the margin the rest of the dashboard shows (see holdClosedMonthGp).
  const stored = new Map<string, StoredMonthTotals>();
  const records = await prisma.salesRecord.findMany({ where: { year: String(year) }, select: { month: true, monthIndex: true, principal: true, revenue: true, grossProfit: true } });
  for (const record of records) {
    const key = storedTotalsKey(`${year}-${String(record.monthIndex + 1).padStart(2, "0")}`, record.principal);
    const existing = stored.get(key) ?? { revenue: 0, grossProfit: 0 };
    stored.set(key, { revenue: existing.revenue + record.revenue, grossProfit: existing.grossProfit + record.grossProfit });
  }
  const held = holdClosedMonthGp({ lines, salesRecordKeys, excludedSales, excludedLines }, stored, asOfMonth);
  console.log(`[performance] Held ${held} closed month x principal group(s) to their stored margin.`);

  // Tie-out against SalesRecord, month by month, so a mismatch is visible in the log.
  for (const [month, sales] of readSales) {
    const storedRevenue = records.filter((r) => `${year}-${String(r.monthIndex + 1).padStart(2, "0")}` === month).reduce((sum, r) => sum + r.revenue, 0);
    const diff = sales - storedRevenue;
    console.log(`[performance] tie-out ${month}: report ${Math.round(sales)} vs SalesRecord ${Math.round(storedRevenue)} (diff ${Math.round(diff)}${storedRevenue ? `, ${((diff / storedRevenue) * 100).toFixed(2)}%` : ""}).`);
  }
  console.log(`[performance] Left out ${excludedLines} line(s) with no active principal, sales ${Math.round(excludedSales)}.`);

  const dashboard = aggregatePerformance(lines, { basis: "dashboard", asOf });
  const recorded = aggregatePerformance(lines, { basis: "recorded", asOf });
  const snapshot: PerformanceSnapshotPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    lineCount: lines.length,
    excludedSales: Math.round(excludedSales),
    excludedLines,
    dashboard,
    recorded,
  };
  console.log(
    `[performance] ${lines.length} lines, ${dashboard.principals.length} principals, ${dashboard.months.length} months: net sales ${dashboard.kpi.sales}, dashboard GP ${dashboard.kpi.gp} (${dashboard.kpi.gpm}%), SAP recorded GP ${recorded.kpi.gp} (${recorded.kpi.gpm}%). Months: ${CANONICAL_MONTHS[0]}..${CANONICAL_MONTHS[lastMonthNo - 1]}.`
  );

  const jsonPath = option("json");
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(snapshot));
  if (dryRun) {
    console.log("[performance] Dry run complete; nothing uploaded.");
    return;
  }
  await post(appUrl, apiKey!, year, snapshot);
  console.log(`[performance] Done - snapshot saved (${Math.round(JSON.stringify(snapshot).length / 1024)} KB).`);
}

main()
  .catch((err) => {
    console.error("[performance] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Performance Analysis refresh: reads the year's SAP invoice and credit-note
// lines one calendar month at a time (peak SAP load is one month), resolves
// principals, holds closed-month gross profit to the stored margin, and replaces
// the stored lines (PerformanceLine) one month per transaction. The page then
// aggregates those lines for whatever period and principals a viewer selects.
//
// Every month is read before anything is written: a failed read aborts the run
// and leaves the previous lines untouched, since a report built from a partial
// year would be wrong, not just stale. Writes go straight to Postgres from the
// worker (like the coverage sync), one transaction per month.
//
//   npm run performance:sync                 current year, replace the stored lines
//   npm run performance:sync -- --dry-run    read + build + tie-out, write nothing
//
// Scheduled daily by scripts/continuous-sync-worker.ts (job "performance").
try {
  process.loadEnvFile(process.env.PERFORMANCE_ENV_FILE ?? ".env");
} catch {
  // env vars may already be provided by the container
}

import { prisma } from "@/lib/db";
import { aggregatePerformance } from "@/lib/performanceAnalysis/aggregate";
import type { PerfLine } from "@/lib/performanceAnalysis/types";
import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchPerformanceLines } from "../queries/performanceLines";
import { loadPrincipals, loadProducts, loadWarehouses } from "../reference/loadFromDb";
import { buildPerformanceLines, holdClosedMonthGp, storedTotalsKey, type StoredMonthTotals } from "../transform/buildPerformanceLines";

const INSERT_CHUNK = 4000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

/** The Nairobi calendar date (YYYY-MM-DD) of `instant`. */
function nairobiDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Replaces one month's stored lines in a single transaction, so readers see the old month or the new one, never half. */
async function replaceMonth(year: number, monthIndex: number, lines: PerfLine[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.performanceLine.deleteMany({ where: { year, monthIndex } });
      for (let start = 0; start < lines.length; start += INSERT_CHUNK) {
        await tx.performanceLine.createMany({
          data: lines.slice(start, start + INSERT_CHUNK).map((line) => ({
            year,
            monthIndex,
            doc: line.doc,
            customerCode: line.customerCode,
            customerName: line.customerName,
            rep: line.rep,
            principal: line.principal,
            itemCode: line.itemCode,
            itemName: line.itemName,
            warehouse: line.warehouse,
            cases: line.cases,
            sales: line.sales,
            gp: line.gp,
          })),
        });
      }
    },
    { timeout: 300_000, maxWait: 60_000 }
  );
}

async function main() {
  const config = loadConfigFromEnv();
  const dryRun = flag("dry-run");

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
  const records = await prisma.salesRecord.findMany({ where: { year: String(year) }, select: { monthIndex: true, principal: true, revenue: true, grossProfit: true } });
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

  const report = aggregatePerformance(lines, { asOf });
  console.log(`[performance] ${lines.length} lines, ${report.principals.length} principals, ${report.months.length} months: net sales ${report.kpi.sales}, GP ${report.kpi.gp} (${report.kpi.gpm}%).`);

  if (dryRun) {
    console.log("[performance] Dry run complete; nothing written.");
    return;
  }

  const byMonth = new Map<number, PerfLine[]>();
  for (const line of lines) {
    const monthIndex = Number(line.month.slice(5, 7)) - 1;
    const bucket = byMonth.get(monthIndex) ?? [];
    bucket.push(line);
    byMonth.set(monthIndex, bucket);
  }
  for (let monthIndex = 0; monthIndex < lastMonthNo; monthIndex += 1) {
    const monthLines = byMonth.get(monthIndex) ?? [];
    await replaceMonth(year, monthIndex, monthLines);
    console.log(`[performance] ${year}-${String(monthIndex + 1).padStart(2, "0")}: saved ${monthLines.length} lines.`);
  }
  const meta = { year, generatedAt: new Date(), asOf, lineCount: lines.length, payload: { excludedSales: Math.round(excludedSales), excludedLines } };
  await prisma.performanceAnalysisSnapshot.upsert({ where: { year }, create: meta, update: meta });
  console.log(`[performance] Done - ${lines.length} lines saved.`);
}

main()
  .catch((err) => {
    console.error("[performance] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

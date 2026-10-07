import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { aggregatePerformance } from "./aggregate";
import type { PerfLine, PerformanceMeta, PerformanceResponse } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 4;

interface CacheEntry {
  at: number;
  lines: PerfLine[];
}

// Reading ~200k lines is the slow part of a report, and the lines only change when the
// daily SAP job runs, so recent reads are kept briefly. The key includes the run's
// generatedAt, so a fresh run is picked up immediately.
const cache = new Map<string, CacheEntry>();

function remember(key: string, lines: PerfLine[]): void {
  cache.set(key, { at: Date.now(), lines });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Run facts for a calendar year (or the latest year that has been built), or null before the first run. */
export async function getPerformanceMeta(year?: number): Promise<PerformanceMeta | null> {
  const row = year === undefined ? await prisma.performanceAnalysisSnapshot.findFirst({ orderBy: { year: "desc" } }) : await prisma.performanceAnalysisSnapshot.findUnique({ where: { year } });
  if (!row) return null;
  const payload = (row.payload ?? {}) as { excludedSales?: unknown; excludedLines?: unknown };
  return {
    year: row.year,
    generatedAt: row.generatedAt.toISOString(),
    asOf: row.asOf,
    lineCount: row.lineCount,
    excludedSales: typeof payload.excludedSales === "number" ? payload.excludedSales : 0,
    excludedLines: typeof payload.excludedLines === "number" ? payload.excludedLines : 0,
  };
}

const monthKey = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

/** The stored lines of a year, narrowed to the selected principal brands (an empty list means every principal). */
async function loadLines(meta: PerformanceMeta, principalKeys: string[]): Promise<PerfLine[]> {
  const wanted = new Set(principalKeys.map((key) => normalizePrincipalKey(key)).filter(Boolean));
  const stored = await prisma.performanceLine.groupBy({ by: ["principal"], where: { year: meta.year } });
  const labels = stored.map((row) => row.principal).filter((label) => wanted.size === 0 || wanted.has(normalizePrincipalKey(label)));
  if (labels.length === 0) return [];

  const key = `${meta.year}|${meta.generatedAt}|${wanted.size === 0 ? "ALL" : [...labels].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.lines;

  const rows = await prisma.performanceLine.findMany({
    where: { year: meta.year, principal: { in: labels } },
    select: { monthIndex: true, doc: true, customerCode: true, customerName: true, rep: true, principal: true, itemCode: true, itemName: true, warehouse: true, cases: true, sales: true, gp: true },
  });
  const lines: PerfLine[] = rows.map((row) => ({
    month: monthKey(meta.year, row.monthIndex),
    doc: row.doc === "credit" ? "credit" : "invoice",
    customerCode: row.customerCode,
    customerName: row.customerName,
    rep: row.rep,
    principal: row.principal,
    itemCode: row.itemCode,
    itemName: row.itemName,
    warehouse: row.warehouse,
    cases: row.cases,
    sales: row.sales,
    gp: row.gp,
  }));
  remember(key, lines);
  return lines;
}

export interface PerformanceReportRequest {
  /** YYYY-MM months of the selected period. Months outside the year of the last one are ignored. */
  months: string[];
  /** Selected principal keys (normalizePrincipalKey form); empty = all. */
  principalKeys: string[];
}

/** The report for one period and principal selection, from the stored SAP lines. */
export async function buildPerformanceReport(request: PerformanceReportRequest): Promise<PerformanceResponse> {
  const months = Array.from(new Set(request.months)).sort();
  const year = months.length > 0 ? Number(months[months.length - 1].slice(0, 4)) : undefined;
  const meta = await getPerformanceMeta(year);
  if (!meta || months.length === 0) return { meta, report: null };
  // Months after the SAP read (the rest of a quarter or half still to come) have no sales yet and must not
  // count as part of the period, or the latest month would be treated as complete-but-empty.
  const asOfMonth = meta.asOf.slice(0, 7);
  const scopeMonths = months.filter((month) => month.startsWith(`${meta.year}-`) && month <= asOfMonth);
  if (scopeMonths.length === 0) return { meta, report: null };

  const lines = await loadLines(meta, request.principalKeys);
  return { meta, report: aggregatePerformance(lines, { asOf: meta.asOf, scopeMonths }) };
}

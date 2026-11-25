import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { getPerformanceMeta } from "@/lib/performanceAnalysis/store";
import type { PerfLine } from "@/lib/performanceAnalysis/types";
import { aggregateCreditNotes, priorWindow, shiftMonth, TREND_MONTHS } from "./aggregate";
import { lineInScope, type LineScope } from "./scope";
import type { CreditNotesMeta, CreditNotesPayload } from "./types";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 4;

interface CacheEntry {
  at: number;
  lines: PerfLine[];
}

// A report reads one or two years of stored lines, and they only change when the daily SAP job
// runs, so recent reads are kept briefly. The key carries the run's generatedAt, so a fresh run
// is picked up at once. Scope and the free-text filter are applied after the cache, per request.
const cache = new Map<string, CacheEntry>();

function remember(key: string, lines: PerfLine[]): void {
  cache.set(key, { at: Date.now(), lines });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface CreditNotesRequest {
  /** YYYY-MM months of the selected period. */
  months: string[];
  /** Selected principal keys (normalizePrincipalKey form); empty = all the viewer may see. */
  principalKeys: string[];
  /** Free-text narrowing across customer, item, rep, principal and branch. */
  query?: string;
  /** The viewer's data scope, null when unrestricted. */
  scope: LineScope | null;
  /** Full-length lists, for the Excel export. */
  full?: boolean;
}

const monthKey = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

async function loadYear(year: number, generatedAt: string): Promise<PerfLine[]> {
  const key = `${year}|${generatedAt}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.lines;
  const rows = await prisma.performanceLine.findMany({
    where: { year },
    select: { monthIndex: true, doc: true, customerCode: true, customerName: true, rep: true, principal: true, itemCode: true, itemName: true, warehouse: true, cases: true, sales: true, gp: true },
  });
  const lines: PerfLine[] = rows.map((row) => ({
    month: monthKey(year, row.monthIndex),
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

/** The earliest month a report for `months` needs: the trend window and the comparison window, whichever reaches back further. */
export function earliestNeededMonth(months: string[]): string {
  const sorted = Array.from(new Set(months)).sort();
  const trendStart = shiftMonth(sorted[sorted.length - 1], -(TREND_MONTHS - 1));
  const priorStart = priorWindow(sorted[0], sorted.length)[0];
  return trendStart < priorStart ? trendStart : priorStart;
}

export interface CreditNotesResult {
  meta: CreditNotesMeta | null;
  report: CreditNotesPayload | null;
}

/** The credit-note report for one period, principal selection, scope and filter, from the stored SAP lines. */
export async function buildCreditNotesReport(request: CreditNotesRequest): Promise<CreditNotesResult> {
  const months = Array.from(new Set(request.months)).sort();
  if (months.length === 0) return { meta: null, report: null };
  const lastYear = Number(months[months.length - 1].slice(0, 4));
  const meta = await getPerformanceMeta(lastYear);
  if (!meta) return { meta: null, report: null };

  // Months after the SAP read have no lines yet and must not count as part of the period.
  const asOfMonth = meta.asOf.slice(0, 7);
  const scopeMonths = months.filter((month) => month <= asOfMonth);
  const creditMeta: CreditNotesMeta = { year: meta.year, generatedAt: meta.generatedAt, asOf: meta.asOf, lineCount: meta.lineCount };
  if (scopeMonths.length === 0) return { meta: creditMeta, report: null };

  const earliest = earliestNeededMonth(scopeMonths);
  const years: number[] = [];
  for (let y = Number(earliest.slice(0, 4)); y <= lastYear; y++) years.push(y);
  const perYear = await Promise.all(
    years.map(async (year) => {
      // Only the newest year's run time is known from `meta`; earlier years are read at their own run time.
      const yearMeta = year === meta.year ? meta : await getPerformanceMeta(year);
      return yearMeta ? loadYear(year, yearMeta.generatedAt) : [];
    }),
  );

  const coveredMonths = new Set(perYear.flat().map((line) => line.month));
  const wanted = new Set(request.principalKeys.map((key) => normalizePrincipalKey(key)).filter(Boolean));
  const lines = perYear
    .flat()
    .filter((line) => line.month >= earliest && line.month <= scopeMonths[scopeMonths.length - 1])
    .filter((line) => wanted.size === 0 || wanted.has(normalizePrincipalKey(line.principal)))
    .filter((line) => lineInScope(line, request.scope));

  const report = aggregateCreditNotes(lines, {
    asOf: meta.asOf,
    scopeMonths,
    query: request.query,
    coveredMonths,
    ...(request.full ? { topItems: Infinity, topCustomers: Infinity, topLines: 5000 } : {}),
  });
  return { meta: creditMeta, report };
}

// Keeps a closed month's margin from being re-costed by a backfill.
//
// The SAP query prices COGS and gross profit from the CURRENT purchase price
// list, so re-reading an old month with today's prices silently rewrites its
// margin (a June row once moved from +9% to -136%). A backfill is only meant to
// refresh what SAP posted late, i.e. revenue. For every row of a closed month
// that is already stored, this restores the stored cost ratios (COGS and gross
// profit as a share of revenue) and applies them to the freshly read revenue.
// Rows with no stored counterpart, or a stored revenue of 0, are left as read.

export interface CostRatios {
  cogs: number;
  grossProfit: number;
}

export type CostRatioMap = Map<string, CostRatios>;

interface CostedRow {
  revenue: number;
  cogs: number;
  grossProfit: number;
}

/** Stores one row's ratios; skipped when its revenue is 0 (no ratio exists). */
export function recordRatios(map: CostRatioMap, key: string, row: CostedRow): void {
  if (row.revenue === 0 || !Number.isFinite(row.revenue)) return;
  map.set(key, { cogs: row.cogs / row.revenue, grossProfit: row.grossProfit / row.revenue });
}

/** Rewrites COGS and gross profit of every closed row that has a stored ratio. Mutates `rows`; returns how many were frozen. */
export function freezeCosts<T extends CostedRow>(rows: T[], keyOf: (row: T) => string, isClosed: (row: T) => boolean, ratios: CostRatioMap): number {
  let frozen = 0;
  for (const row of rows) {
    if (!isClosed(row)) continue;
    const ratio = ratios.get(keyOf(row));
    if (!ratio) continue;
    row.cogs = row.revenue * ratio.cogs;
    row.grossProfit = row.revenue * ratio.grossProfit;
    frozen += 1;
  }
  return frozen;
}

/** A month is closed once the as-of month has begun: strictly before the as-of year/month. */
export function isClosedMonth(year: number, monthIndex: number, asOf: Date): boolean {
  return year * 12 + monthIndex < asOf.getUTCFullYear() * 12 + asOf.getUTCMonth();
}

/** A "YYYY-MM-DD" day is closed when it falls before the first day of the as-of month. */
export function isClosedDay(date: string, asOf: Date): boolean {
  const firstOfMonth = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return date < firstOfMonth;
}

export const monthlyKey = (row: { year: string; month: string; principal: string }) => `${row.year}|${row.month}|${row.principal}`;
export const monthlyRepKey = (row: { year: string; month: string; principal: string; sapName: string }) => `${row.year}|${row.month}|${row.principal}|${row.sapName}`;
export const dailyKey = (row: { date: string; principal: string; location: string }) => `${row.date}|${row.principal}|${row.location}`;
export const dailyRepKey = (row: { date: string; principal: string; sapName: string }) => `${row.date}|${row.principal}|${row.sapName}`;

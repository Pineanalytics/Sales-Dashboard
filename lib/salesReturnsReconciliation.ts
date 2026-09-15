export interface SalesReturnsDailySignature {
  date: string;
  rowCount: number;
  invoiceCount: number;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  totalDiscount: number;
}

const MONEY_TOLERANCE = 0.01;
const QUANTITY_TOLERANCE = 0.001;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

function nairobiMidnight(now: Date, daysAgo: number): Date {
  const nairobi = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  return new Date(Date.UTC(nairobi.getUTCFullYear(), nairobi.getUTCMonth(), nairobi.getUTCDate() - daysAgo));
}

function parseBackfillBoundary(envVar: string, value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${envVar} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${envVar} must be a real YYYY-MM-DD date.`);
  }
  return parsed;
}

/**
 * Resolves an explicitly requested manual run. A bare backfill date is
 * deliberately one calendar day, not "from this date through yesterday";
 * after this process exits, the independent five-minute scheduled task
 * resumes its configured Smart/Catchup mode normally.
 *
 * `backfillToDate` (SALES_RETURNS_BACKFILL_TO) is opt-in and widens that same
 * single day into an explicit [from, to] range in one run — for repairing a
 * companion report (PjpDsrDailyActivity, OutletSkuDailySales) whose per-day
 * grain (see pjpDsrDailyActivityQuery.ts's header) only ever gets populated
 * on a day smart-mode's invoice-line signature actually repairs. A report
 * added after a branch's invoice data was already stable can otherwise miss
 * its entire backlog: no day ever mismatches, so uploadWindow never runs for
 * it. This does not change signature-driven Smart reconciliation at all —
 * every date in the range still overwrites via each upload route's own
 * delete-and-replace-by-window, so re-running it is always safe to repeat.
 * Keep an individual range to a single month or so; a very wide span means a
 * correspondingly long live SQL Server query and upload.
 */
export function resolveManualSalesReturnsWindow(
  window: string,
  backfillDate?: string,
  now = new Date(),
  backfillToDate?: string
): { start: Date; end: Date } {
  if (backfillDate) {
    const start = parseBackfillBoundary("SALES_RETURNS_BACKFILL_FROM", backfillDate);
    if (!backfillToDate) return { start, end: start };
    const end = parseBackfillBoundary("SALES_RETURNS_BACKFILL_TO", backfillToDate);
    if (end.getTime() < start.getTime()) {
      throw new Error("SALES_RETURNS_BACKFILL_TO must not be earlier than SALES_RETURNS_BACKFILL_FROM.");
    }
    return { start, end };
  }

  const today = nairobiMidnight(now, 0);
  const yesterday = nairobiMidnight(now, 1);
  if (window === "today") return { start: today, end: today };
  if (window === "catchup") return { start: yesterday, end: today };
  if (window === "yesterday") return { start: yesterday, end: yesterday };
  throw new Error(`SALES_RETURNS_WINDOW must be "smart", "today", "yesterday", or "catchup" (got "${window}").`);
}

function closeEnough(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function signaturesMatch(
  source: SalesReturnsDailySignature,
  target: SalesReturnsDailySignature
): boolean {
  return (
    source.date === target.date &&
    source.rowCount === target.rowCount &&
    source.invoiceCount === target.invoiceCount &&
    closeEnough(source.saleQtyPieces, target.saleQtyPieces, QUANTITY_TOLERANCE) &&
    closeEnough(source.freeQtyPieces, target.freeQtyPieces, QUANTITY_TOLERANCE) &&
    closeEnough(source.grossSale, target.grossSale, MONEY_TOLERANCE) &&
    closeEnough(source.netSale, target.netSale, MONEY_TOLERANCE) &&
    closeEnough(source.totalDiscount, target.totalDiscount, MONEY_TOLERANCE)
  );
}

function emptySignature(date: string): SalesReturnsDailySignature {
  return {
    date,
    rowCount: 0,
    invoiceCount: 0,
    saleQtyPieces: 0,
    freeQtyPieces: 0,
    grossSale: 0,
    netSale: 0,
    totalDiscount: 0,
  };
}

/**
 * Chooses one bounded repair per scheduler cycle. The oldest mismatch wins so
 * an interrupted/offline machine drains historical gaps before returning to
 * the newest SQL delivery date. Dates that exist only on the VPS are included
 * too: a source-side reconciliation can legitimately remove a whole day.
 */
export function selectOldestMismatch(
  source: SalesReturnsDailySignature[],
  target: SalesReturnsDailySignature[]
): { date: string; source: SalesReturnsDailySignature; target: SalesReturnsDailySignature } | null {
  const sourceByDate = new Map(source.map((row) => [row.date, row]));
  const targetByDate = new Map(target.map((row) => [row.date, row]));
  const dates = Array.from(new Set([...sourceByDate.keys(), ...targetByDate.keys()])).sort();

  for (const date of dates) {
    const sourceRow = sourceByDate.get(date) ?? emptySignature(date);
    const targetRow = targetByDate.get(date) ?? emptySignature(date);
    if (!signaturesMatch(sourceRow, targetRow)) return { date, source: sourceRow, target: targetRow };
  }
  return null;
}

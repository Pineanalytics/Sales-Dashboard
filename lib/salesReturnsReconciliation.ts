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

/**
 * Resolves an explicitly requested manual run. A backfill date is deliberately
 * one calendar day, not "from this date through yesterday"; after this process
 * exits, the independent five-minute scheduled task resumes its configured
 * Smart/Catchup mode normally.
 */
export function resolveManualSalesReturnsWindow(
  window: string,
  backfillDate?: string,
  now = new Date()
): { start: Date; end: Date } {
  if (backfillDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(backfillDate)) {
      throw new Error("SALES_RETURNS_BACKFILL_FROM must be YYYY-MM-DD.");
    }
    const selected = new Date(`${backfillDate}T00:00:00.000Z`);
    if (Number.isNaN(selected.getTime()) || selected.toISOString().slice(0, 10) !== backfillDate) {
      throw new Error("SALES_RETURNS_BACKFILL_FROM must be a real YYYY-MM-DD date.");
    }
    return { start: selected, end: selected };
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

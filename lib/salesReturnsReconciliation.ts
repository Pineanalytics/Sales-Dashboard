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


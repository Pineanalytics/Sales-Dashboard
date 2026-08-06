// Raw pine rows (query.ts) -> OrderRecord upload rows. Deliberately a thin,
// faithful mapping only - no business-rule reinterpretation here. Funnel/pending/
// leaderboard/age figures, the Full-vs-Partial return split, and the
// "firstname.lastname" leaderboard-name / multi-driver-van display conventions are
// all derived live at read time in lib/order360Summary.ts, not baked in here (same
// "store raw, derive on read" split already used by RepCall/lib/timestampSummary.ts).
import type { OrderRow } from "./query";

export interface OrderRecordUploadRow {
  orderDate: Date;
  erpNumber: string;
  invoiceNumber: string | null;
  picklistId: string | null;
  customer: string;
  fsr: string;
  amount: number;

  clearedBy: string | null;
  cleared: boolean;
  clearedDate: Date | null;

  picker: string | null;
  picked: boolean;
  pickDate: Date | null;

  dispatcher: string | null;
  dispatched: boolean;
  dispatchDate: Date | null;

  auditedBy: string | null;
  audited: boolean;

  van: string | null;
  driver: string | null;
  deliveredBy: string | null;
  delivered: boolean;
  deliveryDate: Date | null;

  isReturn: boolean;
  returnDocType: string | null;
  returnedBy: string | null;

  podStatus: string | null;
  stk: boolean;
  paymentRef: string | null;
  amountPaid: number | null;
}

/** Collapses to one row per erpNumber (chunked pulls build non-overlapping date
 *  windows so duplicates shouldn't occur, but an incremental re-run can legitimately
 *  refetch the same order twice across two adjacent daily syncs - last one wins). */
export function buildOrderRecords(rows: OrderRow[]): OrderRecordUploadRow[] {
  const byErp = new Map<string, OrderRow>();
  for (const r of rows) byErp.set(r.erpNumber, r);
  return Array.from(byErp.values()).map((r) => ({ ...r }));
}

// Order 360 SQL — adapted from the user-supplied Order_360_Extractor.py's QUERY,
// verified against the live pine database. Kept as a single wide LEFT-JOIN query
// (SAP_Orders -> users x4 -> loading -> vans -> payments) exactly like the source
// script: SAP_Orders/payments are missing indexes on the columns this joins/filters
// on (Creation_Date, PicklistId, pay_sid/pay_type) and the bridge's DB user can't
// create them, so a wide date range must be pulled as several small concurrent
// chunks rather than one query - see fetchOrdersChunked below.
import type { Connection, RowDataPacket } from "mysql2/promise";

export interface OrderRow {
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

// Same column list/join shape as the Python QUERY string, just re-aliased to
// plain snake_case (mysql2 RowDataPacket) instead of the display-label aliases
// the Excel export used - those display labels are rebuilt in the UI layer, not
// carried through the bridge.
const QUERY = `
  SELECT
      DATE(so.Creation_Date)               AS order_date,
      so.DocNum                            AS erp_number,
      so.Reference_No                      AS invoice_number,
      so.PicklistId                        AS picklist_id,
      so.Customer_Name                     AS customer,
      so.Sales_Employee                    AS fsr,
      so.Sales_Amount                      AS amount,

      CONCAT(CONVERT(cb.first_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,' ',
             CONVERT(cb.last_name  USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS cleared_by,
      CASE WHEN so.Cleared_Status = 'cleared' THEN 1 ELSE 0 END AS cleared,
      so.cleared_at                        AS cleared_date,

      CONCAT(CONVERT(pk.first_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,' ',
             CONVERT(pk.last_name  USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS picker,
      CASE WHEN l.l_picked = 'yes' THEN 1 ELSE 0 END AS picked,
      l.l_pick_date                        AS pick_date,

      CONCAT(CONVERT(dp.first_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,' ',
             CONVERT(dp.last_name  USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS dispatcher,
      CASE WHEN l.l_dispatched = 'yes' THEN 1 ELSE 0 END AS dispatched,
      l.l_dispatch_date                    AS dispatch_date,

      CONCAT(CONVERT(au.first_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,' ',
             CONVERT(au.last_name  USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS audited_by,
      CASE WHEN l.l_auditstatus = 1 THEN 1 ELSE 0 END AS audited,

      CONVERT(v.va_reg USING utf8mb4) COLLATE utf8mb4_unicode_ci AS van,
      CONCAT(CONVERT(dr.first_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,' ',
             CONVERT(dr.last_name  USING utf8mb4) COLLATE utf8mb4_unicode_ci) AS driver,
      CASE WHEN pay.pay_pod IS NOT NULL THEN 1 ELSE 0 END AS delivered,
      pay.pay_date                         AS delivery_date,

      CASE WHEN so.Doc_Type = 'Credit Note' THEN 1 ELSE 0 END AS is_return,
      so.Doc_Type                          AS return_doc_type,
      CASE WHEN so.Doc_Type = 'Credit Note' THEN so.Created_By END AS returned_by,

      pay.pay_pod                          AS pod_status,
      CASE
          WHEN pay.pay_pod IS NOT NULL AND pay.pay_pod <> '' THEN 1
          WHEN pay.pay_reference IS NOT NULL AND pay.pay_reference <> '' THEN 1
          ELSE 0
      END                                   AS stk,
      pay.pay_reference                    AS payment_ref,
      pay.pay_amount                       AS amount_paid

  FROM pine.SAP_Orders so

  LEFT JOIN pine.users cb   ON cb.id = so.cleared_by
  LEFT JOIN pine.loading l  ON l.l_id = so.PicklistId
  LEFT JOIN pine.users pk   ON pk.id = CAST(l.l_picker AS UNSIGNED)
  LEFT JOIN pine.users dp   ON dp.id = l.l_dispatcher
  LEFT JOIN pine.users au   ON au.id = l.l_audits_userid
  LEFT JOIN pine.vans v     ON v.va_id = l.l_van
  LEFT JOIN pine.users dr   ON dr.id = CAST(v.va_userid AS UNSIGNED)
  LEFT JOIN pine.payments pay ON pay.pay_sid = so.id AND pay.pay_type = 'orders'

  WHERE so.Creation_Date >= ?
    AND so.Creation_Date < ?
`;

interface RawOrderRow extends RowDataPacket {
  order_date: Date;
  erp_number: string | number;
  invoice_number: string | null;
  picklist_id: string | number | null;
  customer: string | null;
  fsr: string | null;
  amount: number | null;
  cleared_by: string | null;
  cleared: number;
  cleared_date: Date | null;
  picker: string | null;
  picked: number;
  pick_date: Date | null;
  dispatcher: string | null;
  dispatched: number;
  dispatch_date: Date | null;
  audited_by: string | null;
  audited: number;
  van: string | null;
  driver: string | null;
  delivered: number;
  delivery_date: Date | null;
  is_return: number;
  return_doc_type: string | null;
  returned_by: string | null;
  pod_status: string | null;
  stk: number;
  payment_ref: string | null;
  amount_paid: number | null;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapRow(r: RawOrderRow): OrderRow {
  return {
    orderDate: new Date(r.order_date),
    erpNumber: String(r.erp_number),
    invoiceNumber: blankToNull(r.invoice_number),
    picklistId: r.picklist_id === null ? null : String(r.picklist_id),
    customer: r.customer?.trim() || "Unknown",
    fsr: r.fsr?.trim() || "Unassigned",
    amount: Number(r.amount) || 0,

    clearedBy: blankToNull(r.cleared_by),
    cleared: r.cleared === 1,
    clearedDate: r.cleared_date ? new Date(r.cleared_date) : null,

    picker: blankToNull(r.picker),
    picked: r.picked === 1,
    pickDate: r.pick_date ? new Date(r.pick_date) : null,

    dispatcher: blankToNull(r.dispatcher),
    dispatched: r.dispatched === 1,
    dispatchDate: r.dispatch_date ? new Date(r.dispatch_date) : null,

    auditedBy: blankToNull(r.audited_by),
    audited: r.audited === 1,

    van: blankToNull(r.van),
    driver: blankToNull(r.driver),
    delivered: r.delivered === 1,
    deliveryDate: r.delivery_date ? new Date(r.delivery_date) : null,

    isReturn: r.is_return === 1,
    returnDocType: blankToNull(r.return_doc_type),
    returnedBy: blankToNull(r.returned_by),

    podStatus: blankToNull(r.pod_status),
    stk: r.stk === 1,
    paymentRef: blankToNull(r.payment_ref),
    amountPaid: r.amount_paid === null ? null : Number(r.amount_paid),
  };
}

/** Single-window fetch - fine for a small (e.g. one-day) range. */
export async function fetchOrders(conn: Connection, start: Date, end: Date): Promise<OrderRow[]> {
  const [rows] = await conn.query<RawOrderRow[]>(QUERY, [
    start.toISOString().slice(0, 19).replace("T", " "),
    end.toISOString().slice(0, 19).replace("T", " "),
  ]);
  return rows.map(mapRow);
}

function buildWindows(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  let cur = new Date(start);
  while (cur < end) {
    const winEnd = new Date(Math.min(cur.getTime() + chunkDays * 86400000, end.getTime()));
    windows.push({ start: new Date(cur), end: winEnd });
    cur = winEnd;
  }
  return windows;
}

/** Pulls a wide date range as several small concurrent chunks instead of one big
 *  query - mirrors Order_360_Extractor.py's generate_report_chunked, needed for the
 *  same reason (missing indexes on SAP_Orders/payments make a multi-month single
 *  query time out). Each chunk gets its own connection so failures/slow chunks
 *  don't block the others. */
export async function fetchOrdersChunked(
  makeConnection: () => Promise<Connection>,
  start: Date,
  end: Date,
  chunkDays = 3,
  maxConcurrent = 5
): Promise<OrderRow[]> {
  const windows = buildWindows(start, end, chunkDays);
  const results: OrderRow[][] = new Array(windows.length);

  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= windows.length) return;
      const { start: wStart, end: wEnd } = windows[i];
      const conn = await makeConnection();
      try {
        results[i] = await fetchOrders(conn, wStart, wEnd);
      } finally {
        await conn.end();
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, windows.length || 1) }, () => worker());
  await Promise.all(workers);
  return results.flat();
}

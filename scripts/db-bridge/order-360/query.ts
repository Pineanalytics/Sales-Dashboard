// Order 360 SQL — adapted from the user-supplied orders_360_pymysql.py's QUERY
// (the corrected revision, superseding the original Order_360_Extractor.py),
// verified against the live pine database. Kept as a single wide LEFT-JOIN query
// (SAP_Orders -> users x4 -> loading -> vans -> payments, plus two small lookup
// subqueries) exactly like the source script: SAP_Orders/payments are missing
// indexes on the columns this joins/filters on (Creation_Date, PicklistId,
// pay_sid/pay_type) and the bridge's DB user can't create them, so a wide date
// range must be pulled as several small concurrent chunks rather than one query
// - see fetchOrdersChunked below.
//
// The corrected revision fixed two real bugs the original had (both reported
// against the live dashboard, see lib/order360Summary.ts's header note):
//   1. Payments were joined one-row-per-payment, so an order with >1 payment
//      record (split/multiple STK pushes) fanned out into duplicate order rows
//      (same invoice/amount/date/customer) and "Amount Paid" only reflected one
//      arbitrary payment instead of the true total. Fixed by pre-aggregating
//      payments to one row per order (GROUP BY pay_sid, SUM/GROUP_CONCAT,
//      pay_status = 1 only) before joining.
//   2. "Delivered" required a POD record, so orders dispatched without ever
//      getting a POD/payment confirmation (credit sales paid outside STK, or
//      genuinely lost/unconfirmed deliveries) never counted as delivered,
//      which also made "POD confirmed %" a tautological 100%. Fixed by
//      widening Delivered to include any non-return dispatched order, with a
//      separate `amountPaid !== null` check (see podConfirmed in
//      lib/order360Summary.ts) distinguishing POD/payment-confirmed deliveries
//      from dispatched-only ones for the UI's disclaimer.
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
  deliveredBy: string | null;
  delivered: boolean;
  deliveryDate: Date | null;

  isReturn: boolean;
  returnDocType: string | null;
  returnedBy: string | null;

  podStatus: string | null;
  paymentModes: string | null;
  stk: boolean;
  stkPushStatus: string | null;
  stkPaymentRef: string | null;
  stkAmountPaid: number | null;
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
      CASE WHEN drv.drive_name IS NOT NULL
           THEN CONCAT(drv.drive_name, ' - ', drv.reg_plate)
      END                                   AS delivered_by,

      CASE
          WHEN so.Doc_Type = 'Credit Note' THEN 0
          WHEN pay.delivery_date IS NOT NULL AND pay.total_paid IS NOT NULL THEN 1
          WHEN l.l_dispatched = 'yes' THEN 1
          ELSE 0
      END                                   AS delivered,
      CASE
          WHEN so.Doc_Type = 'Credit Note' THEN NULL
          ELSE COALESCE(pay.delivery_date, l.l_dispatch_date)
      END                                   AS delivery_date,

      CASE WHEN so.Doc_Type = 'Credit Note' THEN 1 ELSE 0 END AS is_return,
      so.Doc_Type                          AS return_doc_type,
      CASE WHEN so.Doc_Type = 'Credit Note' THEN so.Created_By END AS returned_by,

      pay.pod_list                         AS pod_status,
      pay.mode_list                        AS payment_modes,
      CASE WHEN stk.push_status = 'confirmed' THEN 1 ELSE 0 END AS stk,
      stk.push_status                       AS stk_push_status,
      stk.ref_list                          AS stk_payment_ref,
      stk.amount_paid                       AS stk_amount_paid,
      pay.ref_list                         AS payment_ref,
      pay.total_paid                       AS amount_paid

  FROM pine.SAP_Orders so

  LEFT JOIN pine.users cb   ON cb.id = so.cleared_by
  LEFT JOIN pine.loading l  ON l.l_id = so.PicklistId
  LEFT JOIN pine.users pk   ON pk.id = CAST(l.l_picker AS UNSIGNED)
  LEFT JOIN pine.users dp   ON dp.id = l.l_dispatcher
  LEFT JOIN pine.users au   ON au.id = l.l_audits_userid
  LEFT JOIN pine.vans v     ON v.va_id = l.l_van
  LEFT JOIN pine.users dr   ON dr.id = CAST(v.va_userid AS UNSIGNED)

  -- Curated van/driver directory for "Delivered By" - keyed off the driver's
  -- Pine username, kept in sync with orders_360_pymysql.py's own hardcoded
  -- list (that script is the source of truth for this mapping; update both
  -- together if drivers/vans change).
  LEFT JOIN (
      SELECT 'albanus.mutunga'  AS uname, 'Albanus+Lilian'   AS drive_name, 'KCR 085G' AS reg_plate
      UNION ALL SELECT 'malachi.goodluck', 'Munyao+Malachi', 'KDP 440E'
      UNION ALL SELECT 'susan.mwangi',     'Paul+Susan',     'KCR 086G'
      UNION ALL SELECT 'abiud.ocharo',     'Abiud',          'KCR 143P'
      UNION ALL SELECT 'gideon.biwott',    'Gideon+Musyoka', 'KDN 372S'
      UNION ALL SELECT 'emmanuel.okumu',   'Laban+Ochieng',  'KCY 168N'
      UNION ALL SELECT 'lameck.momanyi',   'Lameck',         'KDQ 908D'
      UNION ALL SELECT 'francis.kariuki',  'Cyrus',          'KDP 631X'
      UNION ALL SELECT 'robert.ouko',      'Robert+Timothy', 'KDD 124K'
      UNION ALL SELECT 'edwin.mwaura',     'Mwaura',         'KDL 904E'
      UNION ALL SELECT 'boaz.oduka',       'Boaz',           'KDE 045L'
      UNION ALL SELECT 'purity.wangombe',  'Purity+Bosco',   'KDL 733D'
      UNION ALL SELECT 'reuben.maina',     'Chris+Lavine',   'KCR 088G'
      UNION ALL SELECT 'david.mwololo',    'David+John',     'KDH 253Z'
      UNION ALL SELECT 'joseph.wamai',     'Babayo',         'KDU 963P'
  ) drv ON drv.uname COLLATE utf8mb4_unicode_ci = LOWER(CONVERT(dr.username USING utf8mb4) COLLATE utf8mb4_unicode_ci)

  -- Confirmed payments pre-aggregated to one row per order. Keeping every
  -- payment mode exposes actual payment options; it also prevents split
  -- payments from fanning an order out into duplicate rows.
  LEFT JOIN (
      SELECT
          pay_sid,
          SUM(pay_amount)                                            AS total_paid,
          MAX(pay_date)                                              AS delivery_date,
          GROUP_CONCAT(DISTINCT pay_reference ORDER BY pay_reference SEPARATOR ', ') AS ref_list,
          GROUP_CONCAT(DISTINCT pay_pod       ORDER BY pay_pod       SEPARATOR ', ') AS pod_list,
          GROUP_CONCAT(DISTINCT pay_mode      ORDER BY pay_mode      SEPARATOR ' | ') AS mode_list
      FROM pine.payments
      WHERE pay_type IN ('order', 'orders')
        AND pay_status = 1
      GROUP BY pay_sid
  ) pay ON pay.pay_sid = so.id

  -- STK Push is a payment mode with its own lifecycle. Do not classify an
  -- order as STK merely because it has a POD or a generic payment reference.
  LEFT JOIN (
      SELECT
          pay_sid,
          CASE
              WHEN SUM(CASE WHEN pay_status = 1 THEN 1 ELSE 0 END) > 0 THEN 'confirmed'
              WHEN SUM(CASE WHEN pay_status = 0 THEN 1 ELSE 0 END) > 0 THEN 'pending'
              WHEN SUM(CASE WHEN pay_status = -1 THEN 1 ELSE 0 END) > 0 THEN 'failed'
              ELSE NULL
          END AS push_status,
          SUM(CASE WHEN pay_status = 1 THEN pay_amount ELSE 0 END) AS amount_paid,
          GROUP_CONCAT(DISTINCT CASE WHEN pay_status = 1 THEN pay_reference END ORDER BY pay_reference SEPARATOR ', ') AS ref_list
      FROM pine.payments
      WHERE pay_type IN ('order', 'orders')
        AND pay_mode = 'mpesa_stk_checkout'
      GROUP BY pay_sid
  ) stk ON stk.pay_sid = so.id

  WHERE so.Creation_Date >= CAST(? AS DATE)
    AND so.Creation_Date < DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)
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
  delivered_by: string | null;
  delivered: number;
  delivery_date: Date | null;
  is_return: number;
  return_doc_type: string | null;
  returned_by: string | null;
  pod_status: string | null;
  payment_modes: string | null;
  stk: number;
  stk_push_status: string | null;
  stk_payment_ref: string | null;
  stk_amount_paid: number | null;
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
    deliveredBy: blankToNull(r.delivered_by),
    delivered: r.delivered === 1,
    deliveryDate: r.delivery_date ? new Date(r.delivery_date) : null,

    isReturn: r.is_return === 1,
    returnDocType: blankToNull(r.return_doc_type),
    returnedBy: blankToNull(r.returned_by),

    podStatus: blankToNull(r.pod_status),
    paymentModes: blankToNull(r.payment_modes),
    stk: r.stk === 1,
    stkPushStatus: blankToNull(r.stk_push_status),
    stkPaymentRef: blankToNull(r.stk_payment_ref),
    stkAmountPaid: r.stk_amount_paid === null ? null : Number(r.stk_amount_paid),
    paymentRef: blankToNull(r.payment_ref),
    amountPaid: r.amount_paid === null ? null : Number(r.amount_paid),
  };
}

/** Single-window fetch - fine for a small (e.g. one-day) range. Both bounds are
 *  whole calendar days (CAST(... AS DATE) in the query above, matching the
 *  source script's own chunking) - end is inclusive of its entire day. */
export async function fetchOrders(conn: Connection, start: Date, end: Date): Promise<OrderRow[]> {
  const [rows] = await conn.query<RawOrderRow[]>(QUERY, [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);
  return rows.map(mapRow);
}

// Both bounds passed to the query are inclusive whole calendar days
// (CAST(? AS DATE) / DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY) above, matching
// the source script's own chunking) - each window's end must therefore be one
// day BEFORE the next window's start, or the boundary day gets fetched twice
// (mirrors _build_windows in orders_360_pymysql.py exactly: chunkDays - 1
// offset, cur <= end loop, cur advances to winEnd + 1 day).
function buildWindows(start: Date, end: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  let cur = new Date(start);
  while (cur <= end) {
    const winEnd = new Date(Math.min(cur.getTime() + (chunkDays - 1) * 86400000, end.getTime()));
    windows.push({ start: new Date(cur), end: winEnd });
    cur = new Date(winEnd.getTime() + 86400000);
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

// Fact-line SQL for JP Adherence (Journey Plan / JP Adherence Report / Monthly
// Split), modeled directly on scripts/db-bridge/active-outlets/query.ts — same
// duplication rationale (see that file's own header comment): each bridge
// subtree gets its own copy rather than a cross-import, so it stays
// independently readable/deployable. The one addition here is outlet
// lat/long, which the Active Outlets query never needed but the geo-sweep
// route/home-day algorithm in transform.ts does.
import type { Connection, RowDataPacket } from "mysql2/promise";

export interface OutletRow {
  id: string;
  name: string;
  subChannel: string;
  sourceChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
}

export interface UserRow {
  id: string;
  employee: string;
  userGroup: string;
  region: string;
}

export interface ProductRow {
  id: string;
  sapCode: string;
}

export interface FactLineRow {
  docId: string;
  isOrder: boolean;
  purchaseTime: Date;
  userId: string;
  customerId: string;
  itemId: string;
  qty: number;
  unitPrice: number;
}

export interface NoSaleVisitRow {
  visitId: string;
  visitTime: Date;
  userId: string;
  customerId: string;
  noSaleReason: string | null;
}

// Sub Channel derivation — same CASE as active-outlets/query.ts's SQL_OUTLETS,
// plus lat/long (0,0 is treated as "no geo" downstream in transform.ts, same
// as the Python reference — not filtered out here, that's a transform concern).
const SQL_OUTLETS = `
  SELECT
      o_id,
      o_name,
      CASE
          WHEN o_typename IN ('Distributor','Wholesaler','Large Duka') THEN 'Wholesalers'
          WHEN o_typename IN ('Baby Shop') THEN 'Baby Shop'
          WHEN o_typename IN ('Beauty Shop') THEN 'Beauty Shop'
          WHEN o_typename IN ('Chemist') THEN 'Pharmacies'
          WHEN o_typename IN ('Wines & Spirits') THEN 'Liquor Shops'
          WHEN o_typename IN ('Hotel','Horeca','Golf Clubs') THEN 'Horeca'
          WHEN o_typename IN ('Institutions') THEN 'Institutions'
          WHEN o_typename IN ('Mini Mart/T3 Store','Minimarts') THEN 'Minimart'
          WHEN o_typename IN ('Hypermarts','Supermarket','Hyper') THEN 'Supermarkets'
          WHEN o_typename IS NULL OR o_typename = '' THEN o_channel
          ELSE 'Retailers'
      END AS sub_channel,
      o_channel,
      o_county,
      CAST(o_lat AS DOUBLE)  AS latitude,
      CAST(o_long AS DOUBLE) AS longitude
  FROM pine.outlets
  WHERE o_status = 1
    AND o_name NOT LIKE '%test %'
`;

const SQL_USERS = `
  SELECT id, first_name, last_name, salesgroup, region
  FROM pine.users
`;

const SQL_PRODUCTS = `
  SELECT p_id, p_skucode
  FROM pine.products
  WHERE p_skucode IS NOT NULL
    AND TRIM(p_skucode) <> ''
`;

const SQL_SALE_LINES = `
  SELECT
      s.s_id         AS doc_id,
      s.s_date       AS purchase_time,
      s.s_uid        AS user_id,
      s.s_cid        AS customer_id,
      sd.sd_itemid   AS item_id,
      sd.sd_quantity AS qty,
      sd.sd_price    AS unit_price
  FROM pine.sales s
  INNER JOIN pine.salesdetails sd ON s.s_id = sd.sd_sid
  WHERE s.s_date >= ?
    AND s.s_date < ?
    AND s.s_name NOT LIKE '%test %'
    AND sd.sd_quantity > 0
    AND sd.sd_price > 0
`;

const SQL_ORDER_LINES = `
  SELECT
      ode.ode_id      AS doc_id,
      ode.ode_date    AS purchase_time,
      ode.ode_uid     AS user_id,
      ode.ode_cid     AS customer_id,
      det.od_itemid   AS item_id,
      det.od_quantity AS qty,
      det.od_price    AS unit_price
  FROM pine.orders ode
  INNER JOIN pine.ordersdetails det ON ode.ode_id = det.od_sid
  WHERE ode.ode_date >= ?
    AND ode.ode_date < ?
    AND ode.ode_name NOT LIKE '%test %'
    AND det.od_quantity > 0
    AND det.od_price > 0
`;

export async function fetchOutlets(conn: Connection): Promise<OutletRow[]> {
  const [rows] = await conn.query<
    (RowDataPacket & {
      o_id: number;
      o_name: string;
      sub_channel: string;
      o_channel: string | null;
      o_county: string | null;
      latitude: number | null;
      longitude: number | null;
    })[]
  >(SQL_OUTLETS);
  return rows.map((r) => ({
    id: String(r.o_id),
    name: r.o_name ?? "",
    subChannel: r.sub_channel || "Unknown",
    sourceChannel: r.o_channel?.trim() || "",
    territory: r.o_county?.trim() || "Unassigned",
    latitude: r.latitude === null || r.latitude === undefined ? null : Number(r.latitude),
    longitude: r.longitude === null || r.longitude === undefined ? null : Number(r.longitude),
  }));
}

export async function fetchUsers(conn: Connection): Promise<UserRow[]> {
  const [rows] = await conn.query<(RowDataPacket & { id: number; first_name: string | null; last_name: string | null; salesgroup: string | null; region: string | null })[]>(SQL_USERS);
  return rows.map((r) => ({
    id: String(r.id),
    employee: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    userGroup: r.salesgroup?.trim() || "Unassigned",
    region: r.region?.trim() || "Unassigned",
  }));
}

export async function fetchProducts(conn: Connection): Promise<ProductRow[]> {
  const [rows] = await conn.query<(RowDataPacket & { p_id: number; p_skucode: string })[]>(SQL_PRODUCTS);
  return rows.map((r) => ({ id: String(r.p_id), sapCode: r.p_skucode.trim().toUpperCase() }));
}

async function fetchLines(conn: Connection, sql: string, isOrder: boolean, startDate: Date, endDate: Date): Promise<FactLineRow[]> {
  const start = startDate.toISOString().slice(0, 10);
  // Full timestamp, not just a date — endDate is "today, end of day" (see
  // lookbackWindow()), and truncating it to a bare date turns `< end` into "< today's
  // midnight," silently excluding every sale/order made today.
  const end = endDate.toISOString().slice(0, 19).replace("T", " ");
  const [rows] = await conn.query<(RowDataPacket & { doc_id: number; purchase_time: Date; user_id: number; customer_id: number; item_id: number; qty: number; unit_price: number })[]>(
    sql,
    [start, end]
  );
  return rows.map((r) => ({
    docId: String(r.doc_id),
    isOrder,
    purchaseTime: new Date(r.purchase_time),
    userId: String(r.user_id),
    customerId: String(r.customer_id),
    itemId: String(r.item_id),
    qty: Number(r.qty),
    unitPrice: Number(r.unit_price),
  }));
}

/** Sale + order fact lines for a date range, one row per SKU line — collapsing
 *  to purchase events happens downstream in transform.ts. */
export async function fetchFactLines(conn: Connection, startDate: Date, endDate: Date): Promise<FactLineRow[]> {
  const [sales, orders] = await Promise.all([
    fetchLines(conn, SQL_SALE_LINES, false, startDate, endDate),
    fetchLines(conn, SQL_ORDER_LINES, true, startDate, endDate),
  ]);
  return [...sales, ...orders];
}

/** pine.nosales logs a rep standing in an outlet that bought nothing — the only
 *  place an unproductive visit exists. Column names are auto-detected via
 *  information_schema since they vary/aren't guaranteed — a wrong guess should
 *  degrade to "no unproductive visits reported," not silently mislabel columns. */
export async function resolveNoSalesColumns(conn: Connection): Promise<{ id: string; date: string; uid: string; cid: string; reason: string | null } | null> {
  const [rows] = await conn.query<(RowDataPacket & { COLUMN_NAME: string; DATA_TYPE: string })[]>(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nosales' ORDER BY ORDINAL_POSITION`
  );
  if (rows.length === 0) return null;

  const lower = new Map(rows.map((r) => [r.COLUMN_NAME.toLowerCase(), r.COLUMN_NAME]));
  const temporalTypes = new Set(["datetime", "timestamp", "date"]);
  const typeByName = new Map(rows.map((r) => [r.COLUMN_NAME, r.DATA_TYPE.toLowerCase()]));

  function pick(patterns: string[], wantTemporal = false): string | null {
    for (const pattern of patterns) {
      for (const [low, actual] of lower) {
        if (wantTemporal && !temporalTypes.has(typeByName.get(actual) ?? "")) continue;
        if (low === pattern || low.endsWith(`_${pattern}`) || low.includes(pattern)) return actual;
      }
    }
    return null;
  }

  const id = pick(["id"]);
  const date = pick(["date", "time", "created"], true);
  const uid = pick(["uid", "user_id", "user", "salesman", "rep"]);
  const cid = pick(["cid", "customer_id", "customer", "outlet_id", "outlet"]);
  if (!id || !date || !uid || !cid) return null;
  // Not part of the required gate — a missing reason column degrades to
  // "no reason reported," not to skipping unproductive visits entirely.
  const reason = pick(["remarks", "reason", "note", "comment"]);
  return { id, date, uid, cid, reason };
}

export async function fetchNoSaleVisits(
  conn: Connection,
  columns: { id: string; date: string; uid: string; cid: string; reason: string | null },
  startDate: Date,
  endDate: Date
): Promise<NoSaleVisitRow[]> {
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const reasonSelect = columns.reason ? `, \`${columns.reason}\` AS reason` : "";
  const sql = `SELECT \`${columns.id}\` AS visit_id, \`${columns.date}\` AS visit_time, \`${columns.uid}\` AS user_id, \`${columns.cid}\` AS customer_id${reasonSelect}
               FROM pine.nosales
               WHERE \`${columns.date}\` >= ? AND \`${columns.date}\` < ?`;
  const [rows] = await conn.query<(RowDataPacket & { visit_id: number; visit_time: Date; user_id: number; customer_id: number; reason?: string | null })[]>(sql, [start, end]);
  return rows.map((r) => ({
    visitId: String(r.visit_id),
    visitTime: new Date(r.visit_time),
    userId: String(r.user_id),
    customerId: String(r.customer_id),
    noSaleReason: r.reason?.trim() || null,
  }));
}

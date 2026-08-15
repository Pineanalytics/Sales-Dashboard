// Narrow, streamable fact-line SQL for Active Outlets + Timestamps, modeled on
// the user-supplied Buying_Outlets_By_CostCentre_Extractor script's
// SQL_SALE_LINES/SQL_ORDER_LINES/SQL_OUTLETS/SQL_USERS/SQL_PRODUCTS (that
// script's own header explains why: no server-side GROUP BY/ORDER BY, raw
// fact lines only — a wide aggregating query on this table size is what made
// its old version hang). Deliberately NOT the existing coverage/query.ts: that
// query truncates dates to DATE() and never selects a document id, which is
// fine for distinct-outlet-per-month counts but useless for purchase-event
// collapsing or call sequencing, both of which need the full timestamp + doc id.
import type { Connection, RowDataPacket } from "mysql2/promise";

export interface OutletRow {
  id: string;
  name: string;
  subChannel: string;
  sourceChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  /** Pine's planned PJP owner. It is retained only when it has an active
   * Analytics roster match (applied in run.ts), never used for principal attribution. */
  pjpUserId: string | null;
  pjpRepName: string | null;
  pjpRepGroup: string | null;
  pjpRegion: string | null;
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
  unitsPerCase: number | null;
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

// Sub Channel derivation — same CASE as the source script's SQL_OUTLETS.
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
      o_lat,
      o_pjp_userid,
      CONCAT_WS(' ', pjp.first_name, pjp.last_name) AS pjp_rep_name,
      pjp.salesgroup AS pjp_rep_group,
      pjp.region AS pjp_region
  FROM pine.outlets o
  LEFT JOIN pine.users pjp ON pjp.id = o.o_pjp_userid
  WHERE o.o_status = 1
    AND o.o_name NOT LIKE '%test %'
`;

/** Pine's o_lat is a legacy text field containing "latitude,longitude".
 * Invalid and (0,0) pairs are deliberately withheld instead of placing an
 * outlet at the Gulf of Guinea in the field map. */
function parseCoordinates(value: string | null): { latitude: number | null; longitude: number | null } {
  const match = value?.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return { latitude: null, longitude: null };
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude === 0 && longitude === 0)) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

type OutletSourceRow = RowDataPacket & {
  o_id: number;
  o_name: string;
  sub_channel: string;
  o_channel: string | null;
  o_county: string | null;
  o_lat: string | null;
  o_pjp_userid: number | null;
  pjp_rep_name: string | null;
  pjp_rep_group: string | null;
  pjp_region: string | null;
};

function mapOutlet(r: OutletSourceRow): OutletRow {
  const coordinates = parseCoordinates(r.o_lat);
  return {
    id: String(r.o_id),
    name: r.o_name ?? "",
    subChannel: r.sub_channel || "Unknown",
    sourceChannel: r.o_channel?.trim() || "",
    territory: r.o_county?.trim() || "Unassigned",
    ...coordinates,
    pjpUserId: r.o_pjp_userid && r.o_pjp_userid > 0 ? String(r.o_pjp_userid) : null,
    pjpRepName: r.pjp_rep_name?.trim() || null,
    pjpRepGroup: r.pjp_rep_group?.trim() || null,
    pjpRegion: r.pjp_region?.trim() || null,
  };
}

const SQL_USERS = `
  SELECT id, first_name, last_name, salesgroup, region
  FROM pine.users
`;

const SQL_PRODUCTS = `
  SELECT p_id, p_skucode, p_unitper
  FROM pine.products
  WHERE p_skucode IS NOT NULL
    AND TRIM(p_skucode) <> ''
`;

const ID_QUERY_BATCH_SIZE = 1000;
const PINE_TIME_ZONE = "Africa/Nairobi";

/** The Pine MySQL datetime columns are Nairobi wall-clock values.  MySQL
 * parameters are strings with no offset, so sending Date#toISOString() makes
 * a 12:35 Nairobi cutoff read as 09:35 and omits the latest three hours of
 * sales/orders. */
function pineTimeParts(value: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: PINE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function formatPineLocalDate(value: Date): string {
  const parts = pineTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatPineLocalDateTime(value: Date): string {
  const parts = pineTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function uniqueIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids)).filter(Boolean);
}

function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_QUERY_BATCH_SIZE) batches.push(ids.slice(i, i + ID_QUERY_BATCH_SIZE));
  return batches;
}

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
  const [rows] = await conn.query<OutletSourceRow[]>(SQL_OUTLETS);
  return rows.map(mapOutlet);
}

/** Fetch only the active outlet dimension rows touched by a compact bridge
 * window. The Timestamps job runs every five minutes, so reading all ~77k
 * outlets on every pass would make the dimensions, not the live activity,
 * the dominant Pine workload. */
export async function fetchOutletsByIds(conn: Connection, ids: Iterable<string>): Promise<OutletRow[]> {
  const requested = uniqueIds(ids);
  if (requested.length === 0) return [];

  const rows = await Promise.all(
    idBatches(requested).map(async (batch) => {
      const [result] = await conn.query<OutletSourceRow[]>(
        `${SQL_OUTLETS} AND o_id IN (?)`,
        [batch]
      );
      return result;
    })
  );
  return rows.flat().map(mapOutlet);
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

/** See fetchOutletsByIds: only pull reps which appear in the current rolling
 * Timestamps window rather than the entire Pine user directory. */
export async function fetchUsersByIds(conn: Connection, ids: Iterable<string>): Promise<UserRow[]> {
  const requested = uniqueIds(ids);
  if (requested.length === 0) return [];

  const rows = await Promise.all(
    idBatches(requested).map(async (batch) => {
      const [result] = await conn.query<(RowDataPacket & { id: number; first_name: string | null; last_name: string | null; salesgroup: string | null; region: string | null })[]>(
        `${SQL_USERS} WHERE id IN (?)`,
        [batch]
      );
      return result;
    })
  );
  return rows.flat().map((r) => ({
    id: String(r.id),
    employee: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    userGroup: r.salesgroup?.trim() || "Unassigned",
    region: r.region?.trim() || "Unassigned",
  }));
}

export async function fetchProducts(conn: Connection): Promise<ProductRow[]> {
  const [rows] = await conn.query<(RowDataPacket & { p_id: number; p_skucode: string; p_unitper: number | null })[]>(SQL_PRODUCTS);
  return rows.map((r) => ({ id: String(r.p_id), sapCode: r.p_skucode.trim().toUpperCase(), unitsPerCase: r.p_unitper && Number(r.p_unitper) > 0 ? Number(r.p_unitper) : null }));
}

/** Fetch only product rows referenced by the sale/order lines in a compact
 * Timestamps window. No-sale visits do not need a product lookup. */
export async function fetchProductsByIds(conn: Connection, ids: Iterable<string>): Promise<ProductRow[]> {
  const requested = uniqueIds(ids);
  if (requested.length === 0) return [];

  const rows = await Promise.all(
    idBatches(requested).map(async (batch) => {
      const [result] = await conn.query<(RowDataPacket & { p_id: number; p_skucode: string; p_unitper: number | null })[]>(
        `${SQL_PRODUCTS} AND p_id IN (?)`,
        [batch]
      );
      return result;
    })
  );
  return rows.flat().map((r) => ({ id: String(r.p_id), sapCode: r.p_skucode.trim().toUpperCase(), unitsPerCase: r.p_unitper && Number(r.p_unitper) > 0 ? Number(r.p_unitper) : null }));
}

async function fetchLines(conn: Connection, sql: string, isOrder: boolean, startDate: Date, endDate: Date): Promise<FactLineRow[]> {
  const start = formatPineLocalDate(startDate);
  // Full timestamp, not just a date — endDate is often "now" (or "today, end of day"),
  // and truncating it to a bare date turns `< end` into "< today's midnight," silently
  // excluding every sale/order made today. This was the root cause of today's data
  // never showing up as productive calls until the following day's sync.
  const end = formatPineLocalDateTime(endDate);
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

/** YTD (or any range) sale + order fact lines, one row per SKU line — collapsing to
 *  purchase events happens downstream in transform.ts. */
export async function fetchFactLines(conn: Connection, startDate: Date, endDate: Date): Promise<FactLineRow[]> {
  const [sales, orders] = await Promise.all([
    fetchLines(conn, SQL_SALE_LINES, false, startDate, endDate),
    fetchLines(conn, SQL_ORDER_LINES, true, startDate, endDate),
  ]);
  return [...sales, ...orders];
}

/** pine.nosales logs a rep standing in an outlet that bought nothing — the only place
 *  an unproductive call exists. Column names are auto-detected via information_schema
 *  since they vary/aren't guaranteed, same defensive approach as the source script's
 *  resolve_nosales_columns(): a wrong guess should degrade to "no unproductive calls
 *  reported," not silently mislabel unrelated columns. */
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
  // "no reason reported," not to skipping unproductive calls entirely.
  const reason = pick(["remarks", "reason", "note", "comment"]);
  return { id, date, uid, cid, reason };
}

export async function fetchNoSaleVisits(
  conn: Connection,
  columns: { id: string; date: string; uid: string; cid: string; reason: string | null },
  startDate: Date,
  endDate: Date
): Promise<NoSaleVisitRow[]> {
  const start = formatPineLocalDate(startDate);
  const end = formatPineLocalDate(endDate);
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

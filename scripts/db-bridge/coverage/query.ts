// Verbatim extraction SQL from the user-supplied Principal_CostCentre_Fact.m
// (5-branch UNION ALL: sale / sale_return / order / order_return / nosales),
// adapted only in how dates get into the query — mysql2 parameterized `?`
// placeholders instead of M's inline string concatenation. Every join, filter,
// and CASE expression is otherwise identical to the source script.
import type { Connection, RowDataPacket } from "mysql2/promise";

export type PineTxnType = "sale" | "sale_return" | "order" | "order_return" | string;

export interface PineFactRow {
  type: PineTxnType;
  date: Date;
  userId: string;
  employee: string;
  userGroup: string | null;
  userRegion: string | null;
  customerId: string | null;
  customerName: string | null;
  customerType: string | null;
  sourceChannel: string | null;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  sapCode: string | null;
  productName: string | null;
  uom: string | null;
  qty: number;
  revenue: number;
}

interface PineFactRecord {
  Type: PineTxnType;
  Date: Date | string;
  UserID: string;
  Employee: string;
  UserGroup: string | null;
  UserRegion: string | null;
  CustomerID: string | null;
  CustomerName: string | null;
  CustomerType: string | null;
  SourceChannel: string | null;
  Territory: string | null;
  Latitude: number | null;
  Longitude: number | null;
  SapCode: string | null;
  ProductName: string | null;
  UOM: string | null;
  QTY: number | null;
  Revenue: number | null;
}

const SQL = `
WITH DateFilteredSales AS (
    SELECT s_id, s_uid, s_cid, s_date, s_name
    FROM pine.sales
    WHERE s_date >= ?
      AND s_date < DATE_ADD(?, INTERVAL 1 DAY)
),
DateFilteredNoSales AS (
    SELECT ns_uid, ns_cid, ns_date, ns_operation, ns_name
    FROM pine.nosales
    WHERE ns_date >= ?
      AND ns_date < DATE_ADD(?, INTERVAL 1 DAY)
),
FilteredUsers AS (
    SELECT id, company, first_name, last_name, salesgroup, region, category
    FROM pine.users
    WHERE id NOT IN (325, 385, 324, 326, 1, 362, 371, 556)
      AND salesgroup IN ('DSR', 'MBSR', 'TDR', 'TL', 'KAMs', 'Admin')
),
FilteredOutlets AS (
    SELECT
        o_id, o_name,
        CASE
            WHEN o_typename IN ('Kiosk','GYM','Shop','Retail shop','Small Duka','Home Users','retail','Wines & Spirits') THEN 'Retailers'
            WHEN o_typename IN ('Distributor','Wholesaler','Large Duka') THEN 'Wholesalers'
            WHEN o_typename IN ('Hotel','Horeca','Golf Clubs') THEN 'Horeca'
            WHEN o_typename IN ('Institutions') THEN 'Institutions'
            WHEN o_typename IN ('Chemist') THEN 'Pharmacy'
            WHEN o_typename IN ('Mini Mart/T3 Store','Minimarts') THEN 'Minimart'
            WHEN o_typename IN ('Hypermarts','Supermarket','Hyper') THEN 'LMT'
            WHEN o_typename IS NULL OR o_typename = '' THEN o_channel
            ELSE o_typename
        END AS o_typename,
        o_channel, o_county, o_lat, o_long, o_status
    FROM pine.outlets
    WHERE o_status = 1 AND o_name NOT LIKE '%test %'
),
FilteredProducts AS (
    SELECT p_id, p_name, p_unitper, p_skucode
    FROM pine.products
    WHERE p_skucode IS NOT NULL AND TRIM(p_skucode) <> ''
),
DateFilteredOrders AS (
    SELECT ode_id, ode_uid, ode_cid, ode_date, ode_name
    FROM pine.orders
    WHERE ode_date >= ?
      AND ode_date < DATE_ADD(?, INTERVAL 1 DAY)
),
ActiveProductReps AS (
    SELECT DISTINCT s.s_uid AS uid
    FROM DateFilteredSales s
    INNER JOIN pine.salesdetails sd ON s.s_id = sd.sd_sid
    INNER JOIN FilteredProducts p ON sd.sd_itemid = p.p_id
    INNER JOIN FilteredUsers u ON s.s_uid = u.id
    WHERE s.s_name NOT LIKE '%test %'
    UNION
    SELECT DISTINCT ode.ode_uid AS uid
    FROM DateFilteredOrders ode
    INNER JOIN pine.ordersdetails det ON ode.ode_id = det.od_sid
    INNER JOIN FilteredProducts p ON det.od_itemid = p.p_id
    INNER JOIN FilteredUsers u ON ode.ode_uid = u.id
    WHERE ode.ode_name NOT LIKE '%test %'
)
SELECT * FROM (
    SELECT 'sale' AS Type,
        DATE(s.s_date) AS Date, CAST(s.s_uid AS CHAR) AS UserID,
        CONCAT(u.first_name,' ',u.last_name) AS Employee,
        u.salesgroup AS UserGroup, u.region AS UserRegion,
        CAST(s.s_cid AS CHAR) AS CustomerID, o.o_name AS CustomerName,
        o.o_typename AS CustomerType, o.o_channel AS SourceChannel,
        o.o_county AS Territory,
        CAST(o.o_lat AS DOUBLE) AS Latitude, CAST(o.o_long AS DOUBLE) AS Longitude,
        p.p_skucode AS SapCode, p.p_name AS ProductName,
        p.p_unitper AS UOM, sd.sd_quantity AS QTY,
        ROUND(sd.sd_price * sd.sd_quantity,2) AS Revenue
    FROM DateFilteredSales s
    INNER JOIN pine.salesdetails sd ON s.s_id = sd.sd_sid
    INNER JOIN FilteredUsers u ON s.s_uid = u.id
    INNER JOIN FilteredOutlets o ON s.s_cid = o.o_id
    INNER JOIN FilteredProducts p ON sd.sd_itemid = p.p_id
    WHERE s.s_name NOT LIKE '%test %'
    UNION ALL
    SELECT 'sale_return' AS Type,
        DATE(s.s_date) AS Date, CAST(s.s_uid AS CHAR) AS UserID,
        CONCAT(u.first_name,' ',u.last_name) AS Employee,
        u.salesgroup AS UserGroup, u.region AS UserRegion,
        CAST(s.s_cid AS CHAR) AS CustomerID, o.o_name AS CustomerName,
        o.o_typename AS CustomerType, o.o_channel AS SourceChannel,
        o.o_county AS Territory,
        CAST(o.o_lat AS DOUBLE) AS Latitude, CAST(o.o_long AS DOUBLE) AS Longitude,
        p.p_skucode AS SapCode, p.p_name AS ProductName,
        p.p_unitper AS UOM, -cn.sd_quantity AS QTY,
        ROUND(-cn.sd_price * cn.sd_quantity,2) AS Revenue
    FROM DateFilteredSales s
    INNER JOIN pine.salesdetailsrefund cn ON s.s_id = cn.sd_sid
    INNER JOIN FilteredUsers u ON s.s_uid = u.id
    INNER JOIN FilteredOutlets o ON s.s_cid = o.o_id
    INNER JOIN FilteredProducts p ON cn.sd_itemid = p.p_id
    WHERE s.s_name NOT LIKE '%test %'
    UNION ALL
    SELECT 'order' AS Type,
        DATE(ode.ode_date) AS Date, CAST(ode.ode_uid AS CHAR) AS UserID,
        CONCAT(u.first_name,' ',u.last_name) AS Employee,
        u.salesgroup AS UserGroup, u.region AS UserRegion,
        CAST(ode.ode_cid AS CHAR) AS CustomerID, ode.ode_name AS CustomerName,
        o.o_typename AS CustomerType, o.o_channel AS SourceChannel,
        o.o_county AS Territory,
        CAST(o.o_lat AS DOUBLE) AS Latitude, CAST(o.o_long AS DOUBLE) AS Longitude,
        p.p_skucode AS SapCode, p.p_name AS ProductName,
        p.p_unitper AS UOM, det.od_quantity AS QTY,
        ROUND(det.od_price * det.od_quantity,2) AS Revenue
    FROM DateFilteredOrders ode
    INNER JOIN pine.ordersdetails det ON ode.ode_id = det.od_sid
    INNER JOIN FilteredUsers u ON ode.ode_uid = u.id
    INNER JOIN FilteredOutlets o ON ode.ode_cid = o.o_id
    INNER JOIN FilteredProducts p ON det.od_itemid = p.p_id
    WHERE ode.ode_name NOT LIKE '%test %'
    UNION ALL
    SELECT 'order_return' AS Type,
        DATE(ode.ode_date) AS Date, CAST(ode.ode_uid AS CHAR) AS UserID,
        CONCAT(u.first_name,' ',u.last_name) AS Employee,
        u.salesgroup AS UserGroup, u.region AS UserRegion,
        CAST(ode.ode_cid AS CHAR) AS CustomerID, ode.ode_name AS CustomerName,
        o.o_typename AS CustomerType, o.o_channel AS SourceChannel,
        o.o_county AS Territory,
        CAST(o.o_lat AS DOUBLE) AS Latitude, CAST(o.o_long AS DOUBLE) AS Longitude,
        p.p_skucode AS SapCode, p.p_name AS ProductName,
        p.p_unitper AS UOM, -cn.od_quantity AS QTY,
        ROUND(-cn.od_price * cn.od_quantity,2) AS Revenue
    FROM DateFilteredOrders ode
    INNER JOIN pine.ordersdetailsrefund cn ON ode.ode_id = cn.od_sid
    INNER JOIN FilteredUsers u ON ode.ode_uid = u.id
    INNER JOIN FilteredOutlets o ON ode.ode_cid = o.o_id
    INNER JOIN FilteredProducts p ON cn.od_itemid = p.p_id
    WHERE ode.ode_name NOT LIKE '%test %'
    UNION ALL
    SELECT ns.ns_operation AS Type,
        DATE(ns.ns_date) AS Date, CAST(ns.ns_uid AS CHAR) AS UserID,
        CONCAT(u.first_name,' ',u.last_name) AS Employee,
        u.salesgroup AS UserGroup, u.region AS UserRegion,
        CAST(ns.ns_cid AS CHAR) AS CustomerID, o.o_name AS CustomerName,
        o.o_typename AS CustomerType, o.o_channel AS SourceChannel,
        o.o_county AS Territory,
        CAST(o.o_lat AS DOUBLE) AS Latitude, CAST(o.o_long AS DOUBLE) AS Longitude,
        NULL AS SapCode, NULL AS ProductName, NULL AS UOM,
        0 AS QTY, 0 AS Revenue
    FROM DateFilteredNoSales ns
    INNER JOIN FilteredUsers u ON ns.ns_uid = u.id
    INNER JOIN FilteredOutlets o ON ns.ns_cid = o.o_id
    INNER JOIN ActiveProductReps cr ON ns.ns_uid = cr.uid
    WHERE ns.ns_name NOT LIKE '%test %'
) x
`;

export async function fetchPrincipalCostCentreFact(
  conn: Connection,
  startDate: Date,
  endDate: Date
): Promise<PineFactRow[]> {
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  // 3 date-filtered CTEs (Sales/NoSales/Orders), each taking (start, end).
  const params = [start, end, start, end, start, end];

  const [rows] = await conn.query<(PineFactRecord & RowDataPacket)[]>(SQL, params);

  return rows.map((r) => ({
    type: r.Type,
    date: new Date(r.Date),
    userId: r.UserID,
    employee: r.Employee,
    userGroup: r.UserGroup,
    userRegion: r.UserRegion,
    customerId: r.CustomerID,
    customerName: r.CustomerName,
    customerType: r.CustomerType,
    sourceChannel: r.SourceChannel,
    territory: r.Territory,
    latitude: r.Latitude,
    longitude: r.Longitude,
    sapCode: r.SapCode,
    productName: r.ProductName,
    uom: r.UOM,
    qty: r.QTY ?? 0,
    revenue: r.Revenue ?? 0,
  }));
}

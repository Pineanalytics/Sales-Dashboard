// The Unilever product list data feed (/api/feeds/unilever-products): Unilever's own SKUs as Centegy (Unilever's field sales system) knows them,
// built from what the Sales & Returns sync already stores, not from SAP. Per SKU code:
//   - description, pieces per case and list price per case: Centegy's SKU and price tables as carried on the SKU's sales lines
//     (SalesReturnLine), as of its latest line that has each value;
//   - category and brand: Centegy's product levels 2 and 5, as carried on the outlet x SKU daily sales (OutletSkuDailySales);
//   - In Assortment: the admin-kept Unilever assortment list (UnileverAssortmentSku), whose SKUs are listed even before they first sell;
//   - first and last sale, branches, and the last 90 days' pieces, net sales and outlets, from the sales lines. Sales are document types
//     01/06 and returns 18/19; returns count as a magnitude whatever sign they were stored with (as lib/salesReturns.ts does).
// A SKU Centegy has never sold through Pinefrost and that is not on the assortment list is not in the synced data, so it is not listed.
// loadUnileverProducts reads the database; everything else is pure.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UNILEVER_PRODUCT_COLUMNS } from "@/lib/dataFeedScript";
import { csvCell } from "@/lib/outletUniverse/frequencyExport";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export const UNILEVER_SALES_WINDOW_DAYS = 90;
const SALES_DOC_TYPES = ["01", "06"];
const RETURN_DOC_TYPES = ["18", "19"];
const DAY_MS = 86_400_000;

export interface UnileverProductRow {
  sku: string;
  skuDesc: string | null;
  category: string | null;
  brand: string | null;
  piecesPerCase: number | null;
  listPricePerCase: number | null;
  /** null when the SKU is not on the assortment list; otherwise whether its entry is active. */
  assortmentActive: boolean | null;
  /** Centegy storage locations (branch codes) with lines for the SKU. */
  branches: string[];
  firstSold: Date | null;
  lastSold: Date | null;
  pieces90: number;
  sales90: number;
  returns90: number;
  outlets90: number;
}

export interface UnileverProductData {
  rows: UnileverProductRow[];
  /** The Nairobi day the 90-day window ends on (inclusive), yyyy-mm-dd. */
  asOf: string;
  windowStart: Date;
}

/** The first delivery date in the 90-day window ending today in Nairobi (UTC+3). */
export function unileverSalesWindow(now: Date = new Date()): { start: Date; asOf: string } {
  const nairobi = new Date(now.getTime() + 3 * 3_600_000);
  const today = Date.UTC(nairobi.getUTCFullYear(), nairobi.getUTCMonth(), nairobi.getUTCDate());
  return { start: new Date(today - (UNILEVER_SALES_WINDOW_DAYS - 1) * DAY_MS), asOf: new Date(today).toISOString().slice(0, 10) };
}

export async function loadUnileverProducts(now: Date = new Date()): Promise<UnileverProductData> {
  const { start, asOf } = unileverSalesWindow(now);
  const sales = Prisma.join(SALES_DOC_TYPES);
  const returns = Prisma.join(RETURN_DOC_TYPES);
  const rows = await prisma.$queryRaw<UnileverProductRow[]>(Prisma.sql`
    WITH line_sku AS (
      SELECT BTRIM(sku) AS sku,
        (array_agg(BTRIM("skuDesc") ORDER BY "deliveryDate" DESC) FILTER (WHERE BTRIM("skuDesc") <> ''))[1] AS "skuDesc",
        (array_agg("piecesPerCase" ORDER BY "deliveryDate" DESC) FILTER (WHERE "piecesPerCase" > 0))[1] AS "piecesPerCase",
        (array_agg("listPricePerCase" ORDER BY "deliveryDate" DESC) FILTER (WHERE "listPricePerCase" > 0))[1] AS "listPricePerCase",
        MIN("deliveryDate") FILTER (WHERE "documentType" IN (${sales})) AS "firstSold",
        MAX("deliveryDate") FILTER (WHERE "documentType" IN (${sales})) AS "lastSold",
        COALESCE(SUM("saleQtyPieces") FILTER (WHERE "documentType" IN (${sales}) AND "deliveryDate" >= ${start}), 0)::double precision AS "pieces90",
        COALESCE(SUM("netSale") FILTER (WHERE "documentType" IN (${sales}) AND "deliveryDate" >= ${start}), 0)::double precision AS "sales90",
        COALESCE(ABS(SUM("netSale") FILTER (WHERE "documentType" IN (${returns}) AND "deliveryDate" >= ${start})), 0)::double precision AS "returns90",
        COUNT(DISTINCT ("storageLocation" || '|' || "customerCode")) FILTER (WHERE "documentType" IN (${sales}) AND "deliveryDate" >= ${start})::integer AS "outlets90",
        array_agg(DISTINCT "storageLocation") AS branches
      FROM "SalesReturnLine"
      WHERE BTRIM(sku) <> ''
      GROUP BY BTRIM(sku)
    ),
    outlet_sku AS (
      SELECT BTRIM(sku) AS sku,
        (array_agg(BTRIM(category) ORDER BY date DESC) FILTER (WHERE BTRIM(category) <> ''))[1] AS category,
        (array_agg(BTRIM(brand) ORDER BY date DESC) FILTER (WHERE BTRIM(brand) <> ''))[1] AS brand,
        (array_agg(BTRIM("skuDesc") ORDER BY date DESC) FILTER (WHERE BTRIM("skuDesc") <> ''))[1] AS "skuDesc",
        MIN(date) AS "firstSold",
        MAX(date) AS "lastSold"
      FROM "OutletSkuDailySales"
      WHERE BTRIM(sku) <> ''
      GROUP BY BTRIM(sku)
    ),
    assortment AS (
      SELECT BTRIM(sku) AS sku, NULLIF(BTRIM("skuDesc"), '') AS "skuDesc", bool_or(active) AS active
      FROM "UnileverAssortmentSku"
      WHERE BTRIM(sku) <> ''
      GROUP BY BTRIM(sku), NULLIF(BTRIM("skuDesc"), '')
    ),
    skus AS (
      SELECT sku FROM line_sku UNION SELECT sku FROM outlet_sku UNION SELECT sku FROM assortment
    )
    SELECT s.sku,
      COALESCE(l."skuDesc", o."skuDesc", a."skuDesc") AS "skuDesc",
      o.category, o.brand,
      l."piecesPerCase"::double precision AS "piecesPerCase",
      l."listPricePerCase"::double precision AS "listPricePerCase",
      a.active AS "assortmentActive",
      COALESCE(l.branches, ARRAY[]::text[]) AS branches,
      COALESCE(l."firstSold", o."firstSold") AS "firstSold",
      COALESCE(l."lastSold", o."lastSold") AS "lastSold",
      COALESCE(l."pieces90", 0)::double precision AS "pieces90",
      COALESCE(l."sales90", 0)::double precision AS "sales90",
      COALESCE(l."returns90", 0)::double precision AS "returns90",
      COALESCE(l."outlets90", 0)::integer AS "outlets90"
    FROM skus s
    LEFT JOIN line_sku l ON l.sku = s.sku
    LEFT JOIN outlet_sku o ON o.sku = s.sku
    LEFT JOIN (SELECT DISTINCT ON (sku) sku, "skuDesc", active FROM assortment ORDER BY sku, active DESC) a ON a.sku = s.sku
    ORDER BY o.category NULLS LAST, o.brand NULLS LAST, s.sku
  `);
  return { rows, asOf, windowStart: start };
}

type Cell = string | number;

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const num = (v: number | null, places = 2) => (v === null || !Number.isFinite(v) ? "" : Number(v.toFixed(places)));

/** Active: sold in the window. Otherwise when it last sold, or that it never has (an assortment SKU yet to sell). */
export function unileverProductStatus(row: UnileverProductRow, windowStart: Date): string {
  if (!row.lastSold) return "Never sold";
  return row.lastSold >= windowStart ? "Active" : `Not sold in ${UNILEVER_SALES_WINDOW_DAYS} days`;
}

function columnValue(column: string, row: UnileverProductRow, windowStart: Date): Cell {
  switch (column) {
    case "SKU Code": return row.sku;
    case "SKU Description": return row.skuDesc ?? "";
    case "Category": return row.category ?? "";
    case "Brand": return row.brand ?? "";
    case "Pieces per Case": return num(row.piecesPerCase, 0);
    case "List Price per Case": return num(row.listPricePerCase);
    case "List Price per Piece": return row.listPricePerCase && row.piecesPerCase ? num(row.listPricePerCase / row.piecesPerCase) : "";
    case "In Assortment": return row.assortmentActive === null ? "N" : row.assortmentActive ? "Y" : "N (inactive)";
    case "Status": return unileverProductStatus(row, windowStart);
    case "Branches": return [...new Set(row.branches.map((code) => SALES_RETURNS_BRANCH_LABELS[code] ?? code))].sort().join(", ");
    case "First Sold": return ymd(row.firstSold);
    case "Last Sold": return ymd(row.lastSold);
    case "Pieces Sold (90 days)": return num(row.pieces90, 0);
    case "Net Sales (90 days)": return num(row.sales90 - row.returns90);
    case "Outlets (90 days)": return row.outlets90;
    default: return "";
  }
}

/** The list as CSV: the asked columns (UNILEVER_PRODUCT_COLUMNS names, in the order given; unknown names are skipped), one row per SKU. */
export function unileverProductCsv(data: UnileverProductData, columns: string[]): string {
  const chosen = columns.filter((column) => UNILEVER_PRODUCT_COLUMNS.includes(column));
  const lines = [chosen.map(csvCell).join(",")];
  for (const row of data.rows) lines.push(chosen.map((column) => csvCell(columnValue(column, row, data.windowStart))).join(","));
  return lines.join("\r\n");
}

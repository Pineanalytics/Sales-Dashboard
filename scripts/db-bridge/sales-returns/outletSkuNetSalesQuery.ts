// Outlet x SKU net sales (sales netted against their returns), per delivery
// day — a third report against the same Centegy SQL Server as query.ts and
// pjpSkuQuery.ts (same connection, same run — see run.ts). Unlike
// pjpSkuQuery.ts's whole-month recompute, this groups by delivery date, so
// it's a per-day fact table like query.ts's invoice-line detail: pass the
// sync's own [start, end] window, not a month range, and delete-and-replace
// by that window on upload. Direct port of a hand-run report — only change
// from the original is the DECLARE'd month bounds becoming query parameters.
import sql from "mssql";

export interface OutletSkuDailySalesRow {
  distributor: string;
  distributorName: string;
  pjp: string;
  dsrName: string;
  outletCode: string;
  outletName: string;
  date: string; // "YYYY-MM-DD"
  channel: string;
  category: string;
  brand: string;
  sku: string;
  skuDesc: string;
  pcs: number;
  amount: number;
  discount: number;
  discountPercent: number | null;
  netSales: number;
}

interface OutletSkuDailySalesRecord {
  DISTRIBUTOR: string;
  DT_Name: string;
  PJP_Code: string;
  DSR_Name: string;
  Outlet_code: string;
  Outlet_name: string;
  Channel: string;
  Category: string;
  Brand: string;
  SKU: string;
  "SKU Desc": string;
  PC: number | string | null;
  AMOUNT: number;
  Discount: number;
  "% Discount": number | null;
  "Net Sales": number;
  DATE: Date;
}

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  return typeof value === "string" ? Number(value) : value;
}

/** Fetches Outlet x SKU net sales for [startDate, endDate] (inclusive),
 *  filtered on delivery date exactly like the source report. Bound callers
 *  to the sync's own day window — this is outlet x sku x day grain, not a
 *  month-wide aggregate. */
export async function fetchOutletSkuDailySales(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date
): Promise<OutletSkuDailySalesRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .query<OutletSkuDailySalesRecord>(`
      WITH TotalSales AS (
          SELECT
              cd.DISTRIBUTOR,
              dt.NAME AS DT_Name,
              cm.PJP AS PJP_Code,
              ds.NAME AS DSR_Name,
              cm.TOWN + cm.LOCALITY + cm.SLOCALITY + cm.POP AS Outlet_code,
              po.NAME AS Outlet_name,
              cm.Delv_DATE AS Dates,
              pt.LDESC AS Channel,
              pl.LDESC AS Category,
              p5.LDESC AS Brand,
              cd.SKU,
              sk.LDESC AS [SKU Desc],
              SUM(cd.QTY1 * sk.SELL_FACTOR1) + SUM(cd.QTY2 * sk.SELL_FACTOR2) + SUM(cd.QTY3 * sk.SELL_FACTOR3) AS PC,
              SUM(cd.AMOUNT) AS [AMOUNT],
              SUM(cd.scheme_skushare) AS [Discount],
              ROUND((SUM(cd.scheme_skushare) / NULLIF(SUM(cd.AMOUNT), 0) * 100), 2) AS [% Discount],
              (SUM(cd.AMOUNT) - SUM(cd.scheme_skushare))*1.16 AS [Net Sales],
              CAST(cm.delv_DATE AS DATE) AS [DATE]

          FROM
              CASHMEMO_DETAIL cd
          INNER JOIN
              CASHMEMO cm ON cm.DISTRIBUTOR = cd.DISTRIBUTOR AND cm.DOC_NO = cd.DOC_NO AND cm.DOC_DATE = cd.DOC_DATE
          INNER JOIN
              POP po ON po.DISTRIBUTOR = cm.DISTRIBUTOR AND po.TOWN = cm.TOWN AND po.LOCALITY = cm.LOCALITY AND po.SLOCALITY = cm.SLOCALITY AND po.POP = cm.POP
          INNER JOIN
              POP_TYPE pt ON pt.POPTYPE = po.POPTYPE
          INNER JOIN
              SKU sk ON sk.SKU = cd.SKU
          INNER JOIN
              PROD_LEVEL2 pl ON pl.PROD2 = sk.PROD2
          INNER JOIN
              PROD_LEVEL5 p5 ON p5.PROD5 = sk.PROD5
          INNER JOIN
              DISTRIBUTOR dt ON dt.DISTRIBUTOR = cd.DISTRIBUTOR
          INNER JOIN
              dsr ds ON ds.DISTRIBUTOR = cm.DISTRIBUTOR AND ds.DSR = cm.DSR

          WHERE
              cm.Delv_DATE >= @StartDate AND cm.Delv_DATE <= @EndDate
              AND cm.VISIT_TYPE = '02'

          GROUP BY
              cd.DISTRIBUTOR, dt.NAME, cm.PJP, ds.NAME, cm.DELV_DATE, pt.LDESC, pl.LDESC, p5.LDESC,
              cm.TOWN + cm.LOCALITY + cm.SLOCALITY + cm.POP, po.NAME, cd.SKU, sk.LDESC
      ),

      SalesReturns AS (
          SELECT
              cd.DISTRIBUTOR,
              cm_return.PJP AS PJP_Code,
              ds_return.NAME AS DSR_Name,
              cm_return.TOWN + cm_return.LOCALITY + cm_return.SLOCALITY + cm_return.POP AS Outlet_code,
              po_return.name AS Outlet_name,
              cd.SKU,
              sk.LDESC AS [SKU Desc],
              cm_return.Delv_DATE AS Dates,

              SUM(cd.QTY1 * sk.SELL_FACTOR1) + SUM(cd.QTY2 * sk.SELL_FACTOR2) + SUM(cd.QTY3 * sk.SELL_FACTOR3) AS Total_Returns
          FROM
              CASHMEMO_DETAIL cd
          INNER JOIN
              CASHMEMO cm ON cm.DISTRIBUTOR = cd.DISTRIBUTOR AND cm.DOC_NO = cd.DOC_NO
          INNER JOIN
              CASHMEMO cm_return ON cm_return.DISTRIBUTOR = cm.DISTRIBUTOR AND cm_return.DOC_NO = cm.ref_doc_no
          INNER JOIN
              POP po_return ON po_return.DISTRIBUTOR = cm_return.DISTRIBUTOR AND po_return.TOWN = cm_return.TOWN AND po_return.LOCALITY = cm_return.LOCALITY AND po_return.SLOCALITY = cm_return.SLOCALITY AND po_return.POP = cm_return.POP
          INNER JOIN
              dsr ds_return ON ds_return.DISTRIBUTOR = cm_return.DISTRIBUTOR AND ds_return.DSR = cm_return.DSR
          INNER JOIN
              SKU sk ON sk.SKU = cd.SKU

          WHERE cm_return.Delv_DATE >= @StartDate AND cm_return.Delv_DATE <= @EndDate

          GROUP BY
              cd.DISTRIBUTOR, cd.SKU, cm_return.PJP, ds_return.NAME, cm_return.Delv_DATE,
              cm_return.TOWN + cm_return.LOCALITY + cm_return.SLOCALITY + cm_return.POP, po_return.NAME, cd.SKU, sk.LDESC
      )

      SELECT
          ts.DISTRIBUTOR,
          ts.DT_Name,
          ts.PJP_Code,
          ts.DSR_Name,
          ts.Outlet_code,
          ts.Outlet_name,
          ts.Channel,
          ts.Category,
          ts.Brand,
          ts.SKU,
          ts.[SKU Desc],
          ts.PC + COALESCE(sr.Total_Returns, 0) AS PC,
          ts.[AMOUNT],
          ts.[Discount],
          ts.[% Discount],
          ts.[Net Sales],
          ts.[DATE]

      FROM
          TotalSales ts
      LEFT JOIN
          SalesReturns sr ON ts.DISTRIBUTOR = sr.DISTRIBUTOR AND ts.SKU = sr.SKU AND ts.PJP_Code = sr.PJP_Code AND ts.DSR_Name = sr.DSR_Name AND ts.Outlet_code = sr.Outlet_code AND ts.Dates = sr.Dates
      WHERE
          ts.PC + COALESCE(sr.Total_Returns, 0) > 0 and ts.amount > 0
    `);

  return result.recordset.map((r) => ({
    distributor: r.DISTRIBUTOR,
    distributorName: r.DT_Name,
    pjp: r.PJP_Code,
    dsrName: r.DSR_Name,
    outletCode: r.Outlet_code,
    outletName: r.Outlet_name,
    date: r.DATE.toISOString().slice(0, 10),
    channel: r.Channel,
    category: r.Category,
    brand: r.Brand,
    sku: r.SKU,
    skuDesc: r["SKU Desc"],
    pcs: toNumber(r.PC),
    amount: r.AMOUNT,
    discount: r.Discount,
    discountPercent: r["% Discount"],
    netSales: r["Net Sales"],
  }));
}

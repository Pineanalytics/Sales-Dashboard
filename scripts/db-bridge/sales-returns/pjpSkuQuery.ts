// PJP (route) x SKU month-to-date performance — a second report against the
// same Centegy SQL Server as query.ts's Sales & Returns invoice-line detail
// (same connection, same run — see run.ts). Direct port of a hand-run report:
// only change from the original is the hardcoded month bounds becoming query
// parameters. Unlike query.ts, this is a full-month aggregate recomputed on
// every run, not a per-day fact table — callers should always pass
// [month-start, end-of-current-window], never an arbitrary range.
import sql from "mssql";

export interface PjpSkuPerformanceRow {
  pjp: string;
  route: string;
  skuCode: string;
  skuDesc: string;
  ecoMtd: number;
  skuSales: number;
  pcs: number;
}

interface PjpSkuPerformanceRecord {
  PJP: string;
  ROUTE: string;
  SKU_CODE: string;
  SKU_DESC: string;
  ECO_MTD: number;
  SKU_SALES: number | null;
  PCs: number | null;
}

/** Fetches PJP x SKU performance for [startDate, endDate] (inclusive) — pass
 *  the current month's start and the sync's own window-end, since this
 *  aggregates the whole range rather than a single day. */
export async function fetchPjpSkuPerformance(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date
): Promise<PjpSkuPerformanceRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .query<PjpSkuPerformanceRecord>(`
      SELECT
          ph.pjp AS PJP,
          MAX(ph.LDESC) AS ROUTE,
          su.sku AS SKU_CODE,
          MAX(su.LDESC) AS SKU_DESC,
          COUNT(DISTINCT c.town + c.locality + c.SLOCALITY + c.pop) AS ECO_MTD,
          SUM(cd.AMOUNT) AS SKU_SALES,
          SUM(cd.QTY1 * su.SELL_FACTOR1) + SUM(cd.QTY2 * su.SELL_FACTOR2) + SUM(cd.QTY3 * su.SELL_FACTOR3) AS PCs
      FROM sku su
      INNER JOIN cashmemo_detail cd ON su.sku = cd.sku
      INNER JOIN CASHMEMO c ON cd.DOC_NO = c.DOC_NO
      INNER JOIN PJP_HEAD ph ON c.PJP = ph.PJP
      INNER JOIN (
          SELECT PJP AS pj FROM SECTION_POP_PERMANENT GROUP BY PJP
      ) spp ON spp.pj = ph.PJP
      WHERE
          c.delv_date >= @StartDate AND c.delv_date <= @EndDate
          AND c.VISIT_TYPE = '02'
      GROUP BY su.SKU, ph.PJP
    `);

  return result.recordset.map((r) => ({
    pjp: r.PJP,
    route: r.ROUTE,
    skuCode: r.SKU_CODE,
    skuDesc: r.SKU_DESC,
    ecoMtd: r.ECO_MTD,
    skuSales: r.SKU_SALES ?? 0,
    pcs: r.PCs ?? 0,
  }));
}

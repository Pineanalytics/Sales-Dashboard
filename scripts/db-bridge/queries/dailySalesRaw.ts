// Day-grain sibling of ytdRaw.ts's YTD_Raw query — same proven SalesLines/PriceLists
// CTEs (SAP's OINV/INV1 invoices + ORIN/RIN1 credit notes, same Sales Amount/Gross
// Profit/Gross Sales/COGS logic), but GROUPed BY the actual transaction date instead
// of collapsing to Year+Month. Exists because ytdRaw.ts's own GROUP BY discards the
// real per-row TaxDate before it ever leaves SQL Server — this is a parallel query,
// not a replacement, so the already-verified monthly pipeline (buildMonthlySales.ts)
// is untouched. Only the current "YTD" period is needed here (no LYTD/day-level YoY
// comparison) — Week/Daily Actual cards only ever look at the current period.
import sql from "mssql";

export interface DailySalesRawRow {
  date: string; // "YYYY-MM-DD"
  itemCode: string;
  whsCode: string | null;
  isFreeSale: boolean;
  qtySold: number;
  salesAmount: number;
  grossSales: number;
  cogs: number;
  grossMargin: number;
}

interface DailySalesRawRecord {
  DocDate: Date;
  ItemCode: string;
  WhsCode: string | null;
  "Is Free Sale": number;
  QtySold: number;
  "Sales Amount": number;
  "Gross Sales": number;
  COGs: number;
  "Gross Margin": number;
}

/** Fetches day-grain sales for [startDate, endDate] — callers pass a bounded trailing
 *  window (e.g. start of last month through today), not the whole year, since this
 *  accumulates one row per Item x Warehouse x Day rather than x Month. */
export async function fetchDailySalesRaw(pool: sql.ConnectionPool, startDate: Date, endDate: Date): Promise<DailySalesRawRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, startDate)
    .input("EndDate", sql.Date, endDate)
    .query<DailySalesRawRecord>(`
      WITH PriceLists AS (
          SELECT
              T0.ItemCode,
              MAX(CASE WHEN T2.ListName = 'Purchase Price' THEN T1.Price END) / 1.16 AS [Purchase Price]
          FROM OITM T0
          INNER JOIN ITM1 T1 ON T0.ItemCode = T1.ItemCode
          INNER JOIN OPLN T2 ON T1.PriceList = T2.ListNum
          WHERE
              T1.Price > 0
              AND T2.ListName IN ('Purchase Price', 'Pinefrost Selling Price Inc VAT')
          GROUP BY
              T0.ItemCode
      ),
      SalesLines AS (
          SELECT
              T0.TaxDate AS [Doc Date],
              T1.ItemCode AS [Item Code],
              T1.WhsCode AS [Warehouse Code],
              CASE
                  WHEN T0.CANCELED = 'C' THEN -T1.Quantity
                  ELSE T1.Quantity
              END AS QtySold,
              CASE
                  WHEN T0.isIns = 'N'
                       AND T1.LineTotal > T1.StockSum
                       AND T1.StockSum <> 0
                  THEN T1.StockSum
                  ELSE T1.LineTotal
              END AS [Sales Amount],
              CASE
                  WHEN T0.CANCELED = 'C' THEN -T1.Quantity
                  ELSE T1.Quantity
              END * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM OINV T0
          INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE
              T0.CANCELED = 'N'
              AND T0.TaxDate BETWEEN @StartDate AND @EndDate

          UNION ALL

          SELECT
              T0.TaxDate AS [Doc Date],
              T1.ItemCode AS [Item Code],
              T1.WhsCode AS [Warehouse Code],
              CASE
                  WHEN T0.CANCELED = 'C' THEN T1.Quantity
                  ELSE -T1.Quantity
              END AS QtySold,
              CASE
                  WHEN T0.CANCELED = 'C' THEN T1.StockSum
                  WHEN T1.StockSum = 0 THEN -T1.LineTotal
                  ELSE -T1.StockSum
              END AS [Sales Amount],
              CASE
                  WHEN T0.CANCELED = 'C' THEN T1.Quantity
                  ELSE -T1.Quantity
              END * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM ORIN T0
          INNER JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE
              T0.CANCELED = 'N'
              AND T0.TaxDate BETWEEN @StartDate AND @EndDate
      )

      SELECT
          SL.[Doc Date] AS DocDate,
          SL.[Item Code] AS ItemCode,
          SL.[Warehouse Code] AS WhsCode,
          CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 1 ELSE 0 END AS [Is Free Sale],
          SUM(SL.QtySold) AS QtySold,
          SUM(SL.[Sales Amount]) AS [Sales Amount],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0 ELSE SL.[Gross Sales] END) AS [Gross Sales],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0 ELSE SL.QtySold * ISNULL(PL.[Purchase Price], 0) END) AS [COGs],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0
                   ELSE SL.[Gross Sales] - (SL.QtySold * ISNULL(PL.[Purchase Price], 0))
              END) AS [Gross Margin]
      FROM SalesLines SL
      LEFT JOIN PriceLists PL ON PL.ItemCode = SL.[Item Code]
      GROUP BY
          SL.[Doc Date],
          SL.[Item Code],
          SL.[Warehouse Code],
          CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 1 ELSE 0 END;
    `);

  return result.recordset.map((r) => ({
    date: r.DocDate.toISOString().slice(0, 10),
    itemCode: r.ItemCode,
    whsCode: r.WhsCode,
    isFreeSale: r["Is Free Sale"] === 1,
    qtySold: r.QtySold,
    salesAmount: r["Sales Amount"],
    grossSales: r["Gross Sales"],
    cogs: r.COGs,
    grossMargin: r["Gross Margin"],
  }));
}

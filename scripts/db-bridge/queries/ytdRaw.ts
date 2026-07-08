// Mirrors the "YTD_Raw" Power Query — the closest SQL-side match to the app's
// MonthlySalesRow. Already aggregated in SQL to Year+Month+Item+Warehouse+IsFreeSale
// grain (current calendar year plus a prior-year-same-period "LYTD" slice via
// UNION ALL over OINV/INV1 invoices and ORIN/RIN1 credit notes). Verbatim T-SQL,
// captured directly from the source workbook's M code — no placeholder branches,
// no assumed field names.
import sql from "mssql";

export interface YtdRawRow {
  period: "YTD" | "LYTD";
  year: number;
  monthNo: number; // 1-12, as returned by SQL
  month: string;
  itemCode: string;
  whsCode: string | null;
  isFreeSale: boolean;
  qtySold: number;
  salesAmount: number;
  grossProfit: number;
  grossSales: number;
  cogs: number;
  grossMargin: number;
}

interface YtdRawRecord {
  Period: "YTD" | "LYTD";
  Year: number;
  "Month No": number;
  Month: string;
  "Month-Year": string;
  "Month Date": string;
  ItemCode: string;
  WhsCode: string | null;
  "Is Free Sale": number;
  QtySold: number;
  "Sales Amount": number;
  "Gross Profit": number;
  "Gross Sales": number;
  COGs: number;
  "Gross Margin": number;
}

export async function fetchYtdRaw(pool: sql.ConnectionPool, asOfDate: Date): Promise<YtdRawRow[]> {
  const year = asOfDate.getFullYear();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const result = await pool
    .request()
    .input("StartDate", sql.Date, startDate)
    .input("EndDate", sql.Date, endDate)
    .query<YtdRawRecord>(`
      DECLARE @LYStartDate DATE = DATEADD(YEAR, -1, @StartDate);
      DECLARE @LYEndDate   DATE = DATEADD(YEAR, -1, @EndDate);

      WITH PriceLists AS (
          SELECT
              T0.ItemCode,
              MAX(CASE WHEN T2.ListName = 'Purchase Price' THEN T1.Price END) / 1.16 AS [Purchase Price],
              MAX(CASE WHEN T2.ListName = 'Pinefrost Selling Price Inc VAT' THEN T1.Price END) / 1.16 AS [Pinefrost Selling Price Inc VAT]
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
              'YTD' AS Period,
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
                  WHEN T0.CANCELED = 'C' THEN -T1.GrssProfit
                  ELSE T1.GrssProfit
              END AS [Gross Profit],
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
              'YTD' AS Period,
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
                  WHEN T0.CANCELED = 'C' THEN T1.GrssProfit
                  ELSE -T1.GrssProfit
              END AS [Gross Profit],
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

          UNION ALL

          SELECT
              'LYTD' AS Period,
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
                  WHEN T0.CANCELED = 'C' THEN -T1.GrssProfit
                  ELSE T1.GrssProfit
              END AS [Gross Profit],
              CASE
                  WHEN T0.CANCELED = 'C' THEN -T1.Quantity
                  ELSE T1.Quantity
              END * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM OINV T0
          INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE
              T0.CANCELED = 'N'
              AND T0.TaxDate BETWEEN @LYStartDate AND @LYEndDate

          UNION ALL

          SELECT
              'LYTD' AS Period,
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
                  WHEN T0.CANCELED = 'C' THEN T1.GrssProfit
                  ELSE -T1.GrssProfit
              END AS [Gross Profit],
              CASE
                  WHEN T0.CANCELED = 'C' THEN T1.Quantity
                  ELSE -T1.Quantity
              END * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM ORIN T0
          INNER JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry
          WHERE
              T0.CANCELED = 'N'
              AND T0.TaxDate BETWEEN @LYStartDate AND @LYEndDate
      )

      SELECT
          SL.Period,
          YEAR(SL.[Doc Date]) AS [Year],
          MONTH(SL.[Doc Date]) AS [Month No],
          DATENAME(MONTH, SL.[Doc Date]) AS [Month],
          FORMAT(DATEFROMPARTS(YEAR(SL.[Doc Date]), MONTH(SL.[Doc Date]), 1), 'MMM-yyyy') AS [Month-Year],
          DATEFROMPARTS(YEAR(SL.[Doc Date]), MONTH(SL.[Doc Date]), 1) AS [Month Date],
          SL.[Item Code] AS ItemCode,
          SL.[Warehouse Code] AS WhsCode,
          CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 1 ELSE 0 END AS [Is Free Sale],
          SUM(SL.QtySold) AS QtySold,
          SUM(SL.[Sales Amount]) AS [Sales Amount],
          SUM(SL.[Gross Profit]) AS [Gross Profit],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0 ELSE SL.[Gross Sales] END) AS [Gross Sales],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0 ELSE SL.QtySold * ISNULL(PL.[Purchase Price], 0) END) AS [COGs],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0
                   ELSE SL.[Gross Sales] - (SL.QtySold * ISNULL(PL.[Purchase Price], 0))
              END) AS [Gross Margin]
      FROM SalesLines SL
      LEFT JOIN PriceLists PL ON PL.ItemCode = SL.[Item Code]
      GROUP BY
          SL.Period,
          YEAR(SL.[Doc Date]),
          MONTH(SL.[Doc Date]),
          DATENAME(MONTH, SL.[Doc Date]),
          DATEFROMPARTS(YEAR(SL.[Doc Date]), MONTH(SL.[Doc Date]), 1),
          SL.[Item Code],
          SL.[Warehouse Code],
          CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 1 ELSE 0 END;
    `);

  return result.recordset.map((r) => ({
    period: r.Period,
    year: r.Year,
    monthNo: r["Month No"],
    month: r.Month,
    itemCode: r.ItemCode,
    whsCode: r.WhsCode,
    isFreeSale: r["Is Free Sale"] === 1,
    qtySold: r.QtySold,
    salesAmount: r["Sales Amount"],
    grossProfit: r["Gross Profit"],
    grossSales: r["Gross Sales"],
    cogs: r.COGs,
    grossMargin: r["Gross Margin"],
  }));
}

// Document-line sales for the Performance Analysis module. Same sources and the
// same Sales Amount / Gross Profit / Gross Margin expressions as queries/ytdRaw.ts
// (OINV/INV1 invoices and ORIN/RIN1 credit notes, COGS priced from the Purchase
// Price list), so its totals line up with SalesRecord. The difference is the
// grain: ytdRaw collapses invoices and credit notes together and drops the
// customer code, which this report needs, so here every line keeps
//   Month x Document type x Customer (code) x Item x Warehouse x Salesperson.
// One calendar-month window per call keeps each read small. SELECT only.
import sql from "mssql";

export interface PerformanceLineRow {
  year: number;
  monthNo: number;
  docType: "Invoice" | "Credit Note";
  customerCode: string;
  customerName: string;
  itemCode: string;
  itemName: string;
  whsCode: string | null;
  sapName: string;
  qtySold: number;
  packSize: number | null;
  /** Net sales excl. VAT (credit notes already negative). */
  salesAmount: number;
  /** SAP's own gross profit on the document (moving-average cost). */
  recordedGp: number;
  /** Gross sales less quantity x current purchase price: the dashboard's GP. */
  grossMargin: number;
}

interface PerformanceLineRecord {
  Year: number;
  "Month No": number;
  "Doc Type": "Invoice" | "Credit Note";
  "Customer Code": string;
  "Customer Name": string;
  ItemCode: string;
  ItemName: string;
  WhsCode: string | null;
  "SAP Rep Name": string;
  QtySold: number;
  "Pack Size": number | null;
  "Sales Amount": number;
  "Recorded GP": number;
  "Gross Margin": number;
}

export async function fetchPerformanceLines(pool: sql.ConnectionPool, start: string, end: string): Promise<PerformanceLineRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, start)
    .input("EndDate", sql.Date, end)
    .query<PerformanceLineRecord>(`
      WITH PriceLists AS (
          SELECT
              T0.ItemCode,
              MAX(CASE WHEN T2.ListName = 'Purchase Price' THEN T1.Price END) / 1.16 AS [Purchase Price]
          FROM OITM T0
          INNER JOIN ITM1 T1 ON T0.ItemCode = T1.ItemCode
          INNER JOIN OPLN T2 ON T1.PriceList = T2.ListNum
          WHERE T1.Price > 0 AND T2.ListName = 'Purchase Price'
          GROUP BY T0.ItemCode
      ),
      SalesLines AS (
          SELECT
              'Invoice' AS [Doc Type],
              T0.TaxDate AS [Doc Date],
              T0.CardCode AS [Customer Code],
              T0.CardName AS [Customer Name],
              T1.ItemCode AS [Item Code],
              COALESCE(NULLIF(LTRIM(RTRIM(T2.ItemName)), ''), '(Unspecified product)') AS [Item Name],
              T1.WhsCode AS [Warehouse Code],
              T0.SlpCode AS [Salesperson Code],
              T1.Quantity AS QtySold,
              T2.NumInBuy AS [Pack Size],
              CASE
                  WHEN T0.isIns = 'N' AND T1.LineTotal > T1.StockSum AND T1.StockSum <> 0 THEN T1.StockSum
                  ELSE T1.LineTotal
              END AS [Sales Amount],
              T1.GrssProfit AS [Recorded GP],
              T1.Quantity * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM OINV T0
          INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
          INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
          WHERE T0.CANCELED = 'N' AND T0.TaxDate BETWEEN @StartDate AND @EndDate

          UNION ALL

          SELECT
              'Credit Note' AS [Doc Type],
              T0.TaxDate AS [Doc Date],
              T0.CardCode AS [Customer Code],
              T0.CardName AS [Customer Name],
              T1.ItemCode AS [Item Code],
              COALESCE(NULLIF(LTRIM(RTRIM(T2.ItemName)), ''), '(Unspecified product)') AS [Item Name],
              T1.WhsCode AS [Warehouse Code],
              T0.SlpCode AS [Salesperson Code],
              -T1.Quantity AS QtySold,
              T2.NumInBuy AS [Pack Size],
              CASE
                  WHEN T1.StockSum = 0 THEN -T1.LineTotal
                  ELSE -T1.StockSum
              END AS [Sales Amount],
              -T1.GrssProfit AS [Recorded GP],
              -T1.Quantity * T1.PriceBefDi AS [Gross Sales],
              T1.PriceBefDi AS [Price Before Discount]
          FROM ORIN T0
          INNER JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry
          INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
          WHERE T0.CANCELED = 'N' AND T0.TaxDate BETWEEN @StartDate AND @EndDate
      )
      SELECT
          YEAR(SL.[Doc Date]) AS [Year],
          MONTH(SL.[Doc Date]) AS [Month No],
          SL.[Doc Type],
          SL.[Customer Code],
          COALESCE(NULLIF(LTRIM(RTRIM(SL.[Customer Name])), ''), '(Unknown Customer)') AS [Customer Name],
          SL.[Item Code] AS ItemCode,
          SL.[Item Name] AS ItemName,
          SL.[Warehouse Code] AS WhsCode,
          COALESCE(NULLIF(LTRIM(RTRIM(SR.SlpName)), ''), '(Unassigned)') AS [SAP Rep Name],
          SUM(SL.QtySold) AS QtySold,
          MAX(SL.[Pack Size]) AS [Pack Size],
          SUM(SL.[Sales Amount]) AS [Sales Amount],
          SUM(SL.[Recorded GP]) AS [Recorded GP],
          SUM(CASE WHEN SL.QtySold <> 0 AND ABS(SL.[Price Before Discount]) < 0.01 THEN 0
                   ELSE SL.[Gross Sales] - (SL.QtySold * ISNULL(PL.[Purchase Price], 0))
              END) AS [Gross Margin]
      FROM SalesLines SL
      LEFT JOIN PriceLists PL ON PL.ItemCode = SL.[Item Code]
      LEFT JOIN OSLP SR ON SR.SlpCode = SL.[Salesperson Code]
      GROUP BY
          YEAR(SL.[Doc Date]),
          MONTH(SL.[Doc Date]),
          SL.[Doc Type],
          SL.[Customer Code],
          COALESCE(NULLIF(LTRIM(RTRIM(SL.[Customer Name])), ''), '(Unknown Customer)'),
          SL.[Item Code],
          SL.[Item Name],
          SL.[Warehouse Code],
          COALESCE(NULLIF(LTRIM(RTRIM(SR.SlpName)), ''), '(Unassigned)');
    `);

  return result.recordset.map((r) => ({
    year: r.Year,
    monthNo: r["Month No"],
    docType: r["Doc Type"],
    customerCode: r["Customer Code"],
    customerName: r["Customer Name"],
    itemCode: r.ItemCode,
    itemName: r.ItemName,
    whsCode: r.WhsCode,
    sapName: r["SAP Rep Name"],
    qtySold: Number(r.QtySold) || 0,
    packSize: r["Pack Size"] && r["Pack Size"] > 0 ? Number(r["Pack Size"]) : null,
    salesAmount: Number(r["Sales Amount"]) || 0,
    recordedGp: Number(r["Recorded GP"]) || 0,
    grossMargin: Number(r["Gross Margin"]) || 0,
  }));
}

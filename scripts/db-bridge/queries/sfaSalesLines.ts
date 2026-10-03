// Document-level sibling of dailySalesRaw.ts. Same measure definitions (Sales
// Amount incl. the StockSum rule, Gross Sales, purchase-price COGS, free-sale
// zeroing, credit notes negated) so totals reconcile with the existing sales
// tables — but it keeps what that query throws away: DocNum, CardCode, NumAtCard,
// the SFA outlet name (U_CustomerName) and the salesperson code. Read-only
// SELECT, one row per document x item x warehouse x free-sale flag; callers pass
// a bounded window (one month at a time) to keep memory in check.
import sql from "mssql";

export interface SfaSalesLine {
  docType: "INVOICE" | "CREDIT_NOTE";
  docNum: string;
  docDate: string; // YYYY-MM-DD (SAP TaxDate)
  series: number | null;
  cardCode: string;
  accountName: string;
  sfaName: string | null;
  numAtCard: string | null;
  slpCode: number;
  repName: string;
  itemCode: string;
  itemName: string;
  whsCode: string | null;
  isFreeSale: boolean;
  qty: number;
  packSize: number | null;
  salesAmount: number;
  grossMargin: number;
  sapGrossProfit: number;
}

interface SfaSalesLineRecord {
  DocType: "INVOICE" | "CREDIT_NOTE";
  DocNum: number;
  DocDate: Date;
  Series: number | null;
  CardCode: string;
  CardName: string | null;
  SfaName: string | null;
  NumAtCard: string | null;
  SlpCode: number;
  SlpName: string | null;
  ItemCode: string;
  ItemName: string | null;
  WhsCode: string | null;
  IsFreeSale: number;
  Qty: number;
  PackSize: number | null;
  SalesAmount: number;
  GrossMargin: number;
  SapGrossProfit: number;
}

export async function fetchSfaSalesLines(pool: sql.ConnectionPool, startDate: Date, endDate: Date): Promise<SfaSalesLine[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, startDate)
    .input("EndDate", sql.Date, endDate)
    .query<SfaSalesLineRecord>(`
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
          GROUP BY T0.ItemCode
      ),
      SalesLines AS (
          SELECT
              'INVOICE' AS DocType,
              T0.DocNum,
              T0.TaxDate,
              T0.Series,
              T0.CardCode,
              T0.CardName,
              T0.U_CustomerName AS SfaName,
              T0.NumAtCard,
              T0.SlpCode,
              T1.ItemCode,
              T2.ItemName,
              T1.WhsCode,
              T1.Quantity AS Qty,
              T2.NumInBuy AS PackSize,
              CASE
                  WHEN T0.isIns = 'N' AND T1.LineTotal > T1.StockSum AND T1.StockSum <> 0 THEN T1.StockSum
                  ELSE T1.LineTotal
              END AS SalesAmount,
              T1.Quantity * T1.PriceBefDi AS GrossSales,
              T1.PriceBefDi AS PriceBefDi,
              T1.GrssProfit AS SapGP
          FROM OINV T0
          INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry
          INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
          WHERE T0.CANCELED = 'N' AND T0.TaxDate BETWEEN @StartDate AND @EndDate

          UNION ALL

          SELECT
              'CREDIT_NOTE',
              T0.DocNum,
              T0.TaxDate,
              T0.Series,
              T0.CardCode,
              T0.CardName,
              T0.U_CustomerName,
              T0.NumAtCard,
              T0.SlpCode,
              T1.ItemCode,
              T2.ItemName,
              T1.WhsCode,
              -T1.Quantity,
              T2.NumInBuy,
              CASE WHEN T1.StockSum = 0 THEN -T1.LineTotal ELSE -T1.StockSum END,
              -T1.Quantity * T1.PriceBefDi,
              T1.PriceBefDi,
              -T1.GrssProfit
          FROM ORIN T0
          INNER JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry
          INNER JOIN OITM T2 ON T1.ItemCode = T2.ItemCode
          WHERE T0.CANCELED = 'N' AND T0.TaxDate BETWEEN @StartDate AND @EndDate
      )
      SELECT
          SL.DocType,
          SL.DocNum,
          SL.TaxDate AS DocDate,
          SL.Series,
          SL.CardCode,
          SL.CardName,
          SL.SfaName,
          SL.NumAtCard,
          SL.SlpCode,
          SR.SlpName,
          SL.ItemCode,
          SL.ItemName,
          SL.WhsCode,
          CASE WHEN SL.Qty <> 0 AND ABS(SL.PriceBefDi) < 0.01 THEN 1 ELSE 0 END AS IsFreeSale,
          SUM(SL.Qty) AS Qty,
          MAX(SL.PackSize) AS PackSize,
          SUM(SL.SalesAmount) AS SalesAmount,
          SUM(CASE WHEN SL.Qty <> 0 AND ABS(SL.PriceBefDi) < 0.01 THEN 0
                   ELSE SL.GrossSales - (SL.Qty * ISNULL(PL.[Purchase Price], 0)) END) AS GrossMargin,
          SUM(SL.SapGP) AS SapGrossProfit
      FROM SalesLines SL
      LEFT JOIN PriceLists PL ON PL.ItemCode = SL.ItemCode
      LEFT JOIN OSLP SR ON SR.SlpCode = SL.SlpCode
      GROUP BY
          SL.DocType, SL.DocNum, SL.TaxDate, SL.Series, SL.CardCode, SL.CardName, SL.SfaName, SL.NumAtCard,
          SL.SlpCode, SR.SlpName, SL.ItemCode, SL.ItemName, SL.WhsCode,
          CASE WHEN SL.Qty <> 0 AND ABS(SL.PriceBefDi) < 0.01 THEN 1 ELSE 0 END;
    `);

  return result.recordset.map((r) => ({
    docType: r.DocType,
    docNum: String(r.DocNum),
    docDate: r.DocDate.toISOString().slice(0, 10),
    series: r.Series ?? null,
    cardCode: r.CardCode,
    accountName: r.CardName?.trim() ?? "",
    sfaName: r.SfaName?.trim() || null,
    numAtCard: r.NumAtCard?.trim() || null,
    slpCode: r.SlpCode,
    repName: r.SlpName?.trim() || "(Unassigned)",
    itemCode: r.ItemCode,
    itemName: r.ItemName?.trim() || "(Unspecified product)",
    whsCode: r.WhsCode,
    isFreeSale: r.IsFreeSale === 1,
    qty: Number(r.Qty),
    packSize: r.PackSize && r.PackSize > 0 ? Number(r.PackSize) : null,
    salesAmount: Number(r.SalesAmount),
    grossMargin: Number(r.GrossMargin),
    sapGrossProfit: Number(r.SapGrossProfit),
  }));
}

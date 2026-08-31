// Sales & Returns invoice-line detail — direct port of the hand-run report
// query (CASHMEMO/CASHMEMO_DETAIL/DSR/POP/SKU tables on the field DMS, a SQL
// Server source separate from both SAP (SQLBRIDGE_SQL_*) and PinefrostAnalytics
// (EABL_CALL_SQL_*)). Same CTEs, joins, and GROUP BY as the original — only
// change is DECLARE @start_date/@end_date became query parameters, and
// CM.DELV_DATE (already filtered on, just not previously selected) is now
// also returned so the upload route can delete-and-replace by the exact same
// field the fetch window is bounded by.
import sql from "mssql";

export interface SalesReturnLineRow {
  customerCode: string;
  salesRepCode: string;
  salesRepName: string;
  route: string | null;
  routeName: string;
  invoiceNo: string;
  invoiceDate: string | null; // "YYYY-MM-DD"
  deliveryDate: string; // "YYYY-MM-DD"
  documentType: string;
  documentTypeDesc: string;
  referenceDocument: string | null;
  referenceDocDate: string | null; // "YYYY-MM-DD"
  hdmsOrderNo: string | null;
  sku: string;
  skuDesc: string;
  storageLocation: string;
  piecesPerCase: number | null;
  listPricePerCase: number | null;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  bonusDiscount: number;
  tradeDiscount: number;
  cashDiscount: number;
  totalDiscount: number;
}

export interface SalesReturnsDailySignatureRow {
  date: string;
  rowCount: number;
  invoiceCount: number;
  saleQtyPieces: number;
  freeQtyPieces: number;
  grossSale: number;
  netSale: number;
  totalDiscount: number;
}

interface SalesReturnLineRecord {
  "Customer Code": string;
  "Salesrep Code": string;
  "Salesrep Name": string;
  Route: string | null;
  "Route Name": string;
  "Invoice No": string;
  "Invoice Date": string | number | null;
  "Delivery Date": Date;
  "Document Type": string;
  "Document Type Descrw": string;
  "Reference Document": string | number | null;
  "Reference Doc Date": string | number | null;
  "HDMS Order No": string | null;
  Material: string;
  "Material Desc": string;
  "Storage Location": string;
  "Pieces per Case": number | null;
  "List Price per case": number | null;
  Sale_Qty_Pcs: number | string | null;
  Free_Total_Qty: number | string | null;
  "Gross Sale": number;
  "Net Sale": number;
  Bonus_Discount: number;
  Trade_Discount: number;
  Cash_Discount: number;
  "Total Discount": number;
}

/** mssql returns BIGINT columns (Sale_Qty_Pcs/Free_Total_Qty use CONVERT(BIGINT,...))
 *  as strings when they don't fit a safe JS integer, as numbers otherwise. */
function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  return typeof value === "string" ? Number(value) : value;
}

/** Fetches Sales & Returns invoice-line detail for [startDate, endDate] (inclusive),
 *  filtered on CM.DELV_DATE exactly like the source report. Bound callers to a single
 *  day or a short trailing window — this is invoice x material grain, not aggregated. */
export async function fetchSalesReturnLines(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date,
  distributor: string
): Promise<SalesReturnLineRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .input("Distributor", sql.VarChar, distributor)
    .query<SalesReturnLineRecord>(`
      With K as (
        select SKU,max(PRICE_UNIT1) as Price from price_structure where PRICE_STRUC='0001'
        and SKU in (select SKU from SKU where PROD5 not in ('310101001',
        '390101001',
        '310104E16',
        '31020CE16',
        '310260E16',
        '390104E16','310982E16') and SKU_INDEX !=0)
        and SKU in (select distinct SKU from cashmemo_detail where doc_date>='1-January-2022')
        group by SKU
      )

      ,returnss as(
        select cc.doc_no as rsdocno,cc.ref_doc_no as rsrefdoc,ccc.DOC_DATE as rsdocd from CASHMEMO cc
        inner join cashmemo ccc on ccc.DOC_NO=cc.REF_DOC_NO
        where cc.CASHMEMO_TYPE in ('18','19') AND cc.DELV_DATE >= @StartDate
              AND cc.DELV_DATE <= @EndDate
              AND cc.DISTRIBUTOR = @Distributor
      )

      select
        P.TOWN+P.LOCALITY+P.SLOCALITY+P.POP as [Customer Code],
        CM.DSR as [Salesrep Code],
        DSR.NAME +'_' + cm.DISTRIBUTOR as [Salesrep Name],
        CM.PJP as [Route],
        REPLACE(REPLACE(P.NAME,CHAR(13),''),CHAR(10),'') as [Route Name],
        CM.doc_no+'_'+P.TOWN+P.LOCALITY+P.SLOCALITY+P.POP+'_'+CM.DISTRIBUTOR as [Invoice No],
        ISNULL(convert(varchar(10),CM.DOC_DATE,121),0) as [Invoice Date],
        CM.DELV_DATE as [Delivery Date],
        cm.CASHMEMO_TYPE as [Document Type],
        CASE WHEN CM.CASHMEMO_TYPE = '01'THEN 'Invoice'WHEN cm.CASHMEMO_TYPE = '18' THEN 'Credit for Returns'WHEN cm.CASHMEMO_TYPE = '19' THEN 'Credit for Returns'WHEN cm.CASHMEMO_TYPE = '06' THEN 'Telesale'ELSE 'No tag' END as [Document Type Descrw],
        ISNULL(rs.rsrefdoc + '_' +P.TOWN+P.LOCALITY+P.SLOCALITY+P.POP+'_'+ CM.DISTRIBUTOR, 0) AS [Reference Document],
        ISNULL(convert(varchar(10),rs.rsdocd,121),0) as [Reference Doc Date],
        cm.HHT_SRNO as [HDMS Order No],
        sku.SKU as [Material],
        sku.LDESC as [Material Desc],
        cm.DISTRIBUTOR [Storage Location],
        CAST(SKU.SELL_FACTOR1 AS INT) as [Pieces per Case],
        CAST(k.Price AS NUMERIC(9,2)) as [List Price per case],
        Sum(CASE WHEN FREE = 0 THEN CONVERT(BIGINT,((ISNULL(CD.QTY1,0)*ISNULL(SKU.SELL_FACTOR1,0))+(ISNULL(CD.QTY2,0)*ISNULL(SKU.SELL_FACTOR2,0))+ISNULL(CD.QTY3,0))) END) AS Sale_Qty_Pcs,
        Sum(COALESCE(CASE WHEN FREE = 1 THEN CONVERT(BIGINT,((ISNULL(CD.QTY1,0)*ISNULL(SKU.SELL_FACTOR1,0))+(ISNULL(CD.QTY2,0)*ISNULL(SKU.SELL_FACTOR2,0))+ISNULL(CD.QTY3,0))) END,0)) AS Free_Total_Qty
        ,SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.AMOUNT,0)),16)) as [Gross Sale]
        ,SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.AMOUNT,0)),16)) as [Net Sale]
        , SUM(COALESCE(CASE WHEN CD.SCHEME_TYPE ='B' THEN CD.DISCOUNT END,0)) AS Bonus_Discount
        , SUM(COALESCE(CASE WHEN CD.SCHEME_TYPE ='T' THEN CD.DISCOUNT END,0)) AS Trade_Discount
        , SUM(COALESCE(CASE WHEN CD.SCHEME_TYPE ='A' THEN CD.DISCOUNT END,0)) AS Cash_Discount
        ,SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.DISCOUNT,0)),16)) as [Total Discount]

      FROM CASHMEMO CM
      INNER JOIN (
        SELECT COMPANY, DISTRIBUTOR, DOCUMENT, SUB_DOCUMENT, DOC_NO, SKU, BATCH,NULL SCHEME_TYPE, QTY1, QTY2, QTY3, AMOUNT,0 DISCOUNT, GST, 0 FREE FROM CASHMEMO_DETAIL
        UNION ALL
        SELECT SDD.COMPANY, SDD.DISTRIBUTOR, SDD.DOCUMENT, SDD.SUB_DOCUMENT, SDD.DOC_NO, SDD.SKU, SDD.BATCH, SD.SCHEME_TYPE, 0 QTY1, 0 QTY2, 0 QTY3, 0 AMOUNT, SDD.DISCOUNT, SDD.GST, 0 FREE
        FROM SCHEME_DISCOUNT SD
        INNER JOIN SCHEME_DISCOUNT_DETAIL SDD ON SD.COMPANY = SDD.COMPANY AND SD.DISTRIBUTOR = SDD.DISTRIBUTOR AND SD.DOCUMENT = SDD.DOCUMENT AND SD.SUB_DOCUMENT = SDD.SUB_DOCUMENT AND SD.DOC_NO = SDD.DOC_NO
        AND SD.MP_CODE = SDD.MP_CODE AND SD.SEQ_ID = SDD.SEQ_ID AND SD.SERIAL_NO = SDD.SERIAL_NO
        UNION ALL
        SELECT COMPANY, DISTRIBUTOR, DOCUMENT, SUB_DOCUMENT, DOC_NO, SKU, BATCH,NULL SCHEME_TYPE, QTY1, QTY2, QTY3, 0 AS AMOUNT, 0 DISCOUNT, GST, 1 FREE FROM SCHEME_SKU
      ) CD
      ON CM.COMPANY = CD.COMPANY AND CM. DISTRIBUTOR = CD .DISTRIBUTOR AND CM.DOCUMENT = CD.DOCUMENT AND CM.SUB_DOCUMENT = CD.SUB_DOCUMENT AND CM. DOC_NO = CD. DOC_NO
      INNER LOOP JOIN SKU ON SKU.COMPANY = CD.COMPANY AND SKU.SKU = CD.SKU
      INNER JOIN DSR ON CM.COMPANY = DSR.COMPANY and  CM.DISTRIBUTOR = DSR.DISTRIBUTOR AND CM.DSR = DSR.DSR
      INNER JOIN POP P ON P.COMPANY = CM.COMPANY AND P.DISTRIBUTOR = CM.DISTRIBUTOR AND P.TOWN = CM.TOWN AND P.LOCALITY = CM.LOCALITY AND P.SLOCALITY = CM.SLOCALITY AND P.POP = CM.POP
      left join k on K.SKU=CD.SKU
      left join returnss rs on rs.rsdocno=cm.DOC_NO
      where cm.DELV_DATE >= @StartDate and cm.DELV_DATE <= @EndDate
            and cm.VISIT_TYPE in('02')
            and cm.DISTRIBUTOR = @Distributor
      GROUP BY
      CM.Distributor, P.POP, P.SLOCALITY,P.LOCALITY, P.TOWN, CM.PJP, CM.DSR, DSR.NAME, P.TOWN + P.LOCALITY + P.SLOCALITY + P.POP, P.NAME, SKU.SKU, SKU.LDESC, CM.DOC_DATE, CM.DELV_DATE, CM.CASHMEMO_TYPE, K.price, CM.doc_no, CM.HHT_SRNO, SKU.SELL_FACTOR1, DSR.DISTRIBUTOR, CM.DISTRIBUTOR, rs.rsrefdoc, rs.rsdocd,
        CASE
        WHEN CM.CASHMEMO_TYPE = '01' THEN 'Invoice'
        WHEN CM.CASHMEMO_TYPE = '18' THEN 'Credit for Returns'
        WHEN CM.CASHMEMO_TYPE = '19' THEN 'Credit for Returns'
        WHEN CM.CASHMEMO_TYPE = '06' THEN 'Telesale'
        ELSE 'No tag'
        END
    `);

  return result.recordset.map((r) => ({
    customerCode: r["Customer Code"],
    salesRepCode: r["Salesrep Code"],
    salesRepName: r["Salesrep Name"],
    route: r.Route,
    routeName: r["Route Name"],
    invoiceNo: r["Invoice No"],
    invoiceDate: r["Invoice Date"] && r["Invoice Date"] !== 0 ? String(r["Invoice Date"]) : null,
    deliveryDate: r["Delivery Date"].toISOString().slice(0, 10),
    documentType: r["Document Type"],
    documentTypeDesc: r["Document Type Descrw"],
    referenceDocument: r["Reference Document"] && r["Reference Document"] !== 0 ? String(r["Reference Document"]) : null,
    referenceDocDate: r["Reference Doc Date"] && r["Reference Doc Date"] !== 0 ? String(r["Reference Doc Date"]) : null,
    hdmsOrderNo: r["HDMS Order No"],
    sku: r.Material,
    skuDesc: r["Material Desc"],
    storageLocation: r["Storage Location"],
    piecesPerCase: r["Pieces per Case"],
    listPricePerCase: r["List Price per case"],
    saleQtyPieces: toNumber(r.Sale_Qty_Pcs),
    freeQtyPieces: toNumber(r.Free_Total_Qty),
    grossSale: r["Gross Sale"],
    netSale: r["Net Sale"],
    bonusDiscount: r.Bonus_Discount,
    tradeDiscount: r.Trade_Discount,
    cashDiscount: r.Cash_Discount,
    totalDiscount: r["Total Discount"],
  }));
}

interface LatestDeliveryDateRecord {
  LatestDeliveryDate: Date | null;
}

/** Latest non-future delivery date that has at least one detail row. Future
 * dated Centegy placeholders are deliberately ignored; the scheduler should
 * move forward only when real transactions appear for a new delivery day. */
export async function fetchLatestSalesReturnDate(
  pool: sql.ConnectionPool,
  distributor: string,
  today: Date
): Promise<Date | null> {
  const result = await pool
    .request()
    .input("Distributor", sql.VarChar, distributor)
    .input("Today", sql.DateTime2, today)
    .query<LatestDeliveryDateRecord>(`
      SELECT MAX(CAST(cm.DELV_DATE AS date)) AS LatestDeliveryDate
      FROM CASHMEMO cm
      WHERE cm.DISTRIBUTOR = @Distributor
        AND cm.VISIT_TYPE = '02'
        AND cm.DELV_DATE <= @Today
        AND EXISTS (
          SELECT 1
          FROM CASHMEMO_DETAIL cd
          WHERE cd.COMPANY = cm.COMPANY
            AND cd.DISTRIBUTOR = cm.DISTRIBUTOR
            AND cd.DOCUMENT = cm.DOCUMENT
            AND cd.SUB_DOCUMENT = cm.SUB_DOCUMENT
            AND cd.DOC_NO = cm.DOC_NO
        )
    `);
  return result.recordset[0]?.LatestDeliveryDate ?? null;
}

interface DailySignatureRecord {
  DeliveryDate: Date;
  SignatureRowCount: number;
  InvoiceCount: number;
  SaleQtyPieces: number | string | null;
  FreeQtyPieces: number | string | null;
  GrossSale: number | string | null;
  NetSale: number | string | null;
  TotalDiscount: number | string | null;
}

/** Exact daily signature of the invoice-line report's output grain. This is
 * intentionally the same joins, union, filters, and GROUP BY as the detailed
 * extraction above, aggregated one level higher. Comparing these values with
 * PostgreSQL catches reconciled amounts/quantities as well as missing rows. */
export async function fetchSalesReturnDailySignatures(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date,
  distributor: string
): Promise<SalesReturnsDailySignatureRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .input("Distributor", sql.VarChar, distributor)
    .query<DailySignatureRecord>(`
      WITH K AS (
        SELECT SKU, MAX(PRICE_UNIT1) AS Price
        FROM price_structure
        WHERE PRICE_STRUC = '0001'
          AND SKU IN (
            SELECT SKU FROM SKU
            WHERE PROD5 NOT IN ('310101001','390101001','310104E16','31020CE16','310260E16','390104E16','310982E16')
              AND SKU_INDEX != 0
          )
          AND SKU IN (SELECT DISTINCT SKU FROM cashmemo_detail WHERE doc_date >= '1-January-2022')
        GROUP BY SKU
      ),
      returnss AS (
        SELECT cc.doc_no AS rsdocno, cc.ref_doc_no AS rsrefdoc, ccc.DOC_DATE AS rsdocd
        FROM CASHMEMO cc
        INNER JOIN CASHMEMO ccc ON ccc.DOC_NO = cc.REF_DOC_NO
        WHERE cc.CASHMEMO_TYPE IN ('18','19')
          AND cc.DELV_DATE >= @StartDate AND cc.DELV_DATE <= @EndDate
          AND cc.DISTRIBUTOR = @Distributor
      ),
      SourceLines AS (
        SELECT
          CM.DELV_DATE AS DeliveryDate,
          CM.doc_no + '_' + P.TOWN + P.LOCALITY + P.SLOCALITY + P.POP + '_' + CM.DISTRIBUTOR AS InvoiceNo,
          SKU.SKU AS Material,
          SUM(CASE WHEN FREE = 0 THEN CONVERT(BIGINT,
            (ISNULL(CD.QTY1,0) * ISNULL(SKU.SELL_FACTOR1,0)) +
            (ISNULL(CD.QTY2,0) * ISNULL(SKU.SELL_FACTOR2,0)) + ISNULL(CD.QTY3,0)) END) AS SaleQtyPieces,
          SUM(COALESCE(CASE WHEN FREE = 1 THEN CONVERT(BIGINT,
            (ISNULL(CD.QTY1,0) * ISNULL(SKU.SELL_FACTOR1,0)) +
            (ISNULL(CD.QTY2,0) * ISNULL(SKU.SELL_FACTOR2,0)) + ISNULL(CD.QTY3,0)) END,0)) AS FreeQtyPieces,
          SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.AMOUNT,0)),16)) AS GrossSale,
          SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.AMOUNT,0)),16)) AS NetSale,
          SUM(ROUND(CONVERT(NUMERIC(38,16),COALESCE(CD.DISCOUNT,0)),16)) AS TotalDiscount
        FROM CASHMEMO CM
        INNER JOIN (
          SELECT COMPANY, DISTRIBUTOR, DOCUMENT, SUB_DOCUMENT, DOC_NO, SKU, BATCH, NULL AS SCHEME_TYPE,
                 QTY1, QTY2, QTY3, AMOUNT, 0 AS DISCOUNT, GST, 0 AS FREE
          FROM CASHMEMO_DETAIL
          UNION ALL
          SELECT SDD.COMPANY, SDD.DISTRIBUTOR, SDD.DOCUMENT, SDD.SUB_DOCUMENT, SDD.DOC_NO, SDD.SKU, SDD.BATCH,
                 SD.SCHEME_TYPE, 0, 0, 0, 0, SDD.DISCOUNT, SDD.GST, 0
          FROM SCHEME_DISCOUNT SD
          INNER JOIN SCHEME_DISCOUNT_DETAIL SDD
            ON SD.COMPANY = SDD.COMPANY AND SD.DISTRIBUTOR = SDD.DISTRIBUTOR
           AND SD.DOCUMENT = SDD.DOCUMENT AND SD.SUB_DOCUMENT = SDD.SUB_DOCUMENT
           AND SD.DOC_NO = SDD.DOC_NO AND SD.MP_CODE = SDD.MP_CODE
           AND SD.SEQ_ID = SDD.SEQ_ID AND SD.SERIAL_NO = SDD.SERIAL_NO
          UNION ALL
          SELECT COMPANY, DISTRIBUTOR, DOCUMENT, SUB_DOCUMENT, DOC_NO, SKU, BATCH, NULL,
                 QTY1, QTY2, QTY3, 0, 0, GST, 1
          FROM SCHEME_SKU
        ) CD
          ON CM.COMPANY = CD.COMPANY AND CM.DISTRIBUTOR = CD.DISTRIBUTOR
         AND CM.DOCUMENT = CD.DOCUMENT AND CM.SUB_DOCUMENT = CD.SUB_DOCUMENT AND CM.DOC_NO = CD.DOC_NO
        INNER LOOP JOIN SKU ON SKU.COMPANY = CD.COMPANY AND SKU.SKU = CD.SKU
        INNER JOIN DSR ON CM.COMPANY = DSR.COMPANY AND CM.DISTRIBUTOR = DSR.DISTRIBUTOR AND CM.DSR = DSR.DSR
        INNER JOIN POP P ON P.COMPANY = CM.COMPANY AND P.DISTRIBUTOR = CM.DISTRIBUTOR
         AND P.TOWN = CM.TOWN AND P.LOCALITY = CM.LOCALITY AND P.SLOCALITY = CM.SLOCALITY AND P.POP = CM.POP
        LEFT JOIN K ON K.SKU = CD.SKU
        LEFT JOIN returnss rs ON rs.rsdocno = CM.DOC_NO
        WHERE CM.DELV_DATE >= @StartDate AND CM.DELV_DATE <= @EndDate
          AND CM.VISIT_TYPE = '02'
          AND CM.DISTRIBUTOR = @Distributor
        GROUP BY
          CM.Distributor, P.POP, P.SLOCALITY, P.LOCALITY, P.TOWN, CM.PJP, CM.DSR, DSR.NAME,
          P.TOWN + P.LOCALITY + P.SLOCALITY + P.POP, P.NAME, SKU.SKU, SKU.LDESC,
          CM.DOC_DATE, CM.DELV_DATE, CM.CASHMEMO_TYPE, K.price, CM.doc_no, CM.HHT_SRNO,
          SKU.SELL_FACTOR1, DSR.DISTRIBUTOR, CM.DISTRIBUTOR, rs.rsrefdoc, rs.rsdocd,
          CASE
            WHEN CM.CASHMEMO_TYPE = '01' THEN 'Invoice'
            WHEN CM.CASHMEMO_TYPE IN ('18','19') THEN 'Credit for Returns'
            WHEN CM.CASHMEMO_TYPE = '06' THEN 'Telesale'
            ELSE 'No tag'
          END
      )
      SELECT
        DeliveryDate,
        COUNT(*) AS SignatureRowCount,
        COUNT(DISTINCT InvoiceNo) AS InvoiceCount,
        SUM(COALESCE(SaleQtyPieces, 0)) AS SaleQtyPieces,
        SUM(COALESCE(FreeQtyPieces, 0)) AS FreeQtyPieces,
        SUM(COALESCE(GrossSale, 0)) AS GrossSale,
        SUM(COALESCE(NetSale, 0)) AS NetSale,
        SUM(COALESCE(TotalDiscount, 0)) AS TotalDiscount
      FROM SourceLines
      GROUP BY DeliveryDate
      ORDER BY DeliveryDate
    `);

  return result.recordset.map((row) => ({
    date: row.DeliveryDate.toISOString().slice(0, 10),
    rowCount: Number(row.SignatureRowCount),
    invoiceCount: Number(row.InvoiceCount),
    saleQtyPieces: Number(row.SaleQtyPieces ?? 0),
    freeQtyPieces: Number(row.FreeQtyPieces ?? 0),
    grossSale: Number(row.GrossSale ?? 0),
    netSale: Number(row.NetSale ?? 0),
    totalDiscount: Number(row.TotalDiscount ?? 0),
  }));
}

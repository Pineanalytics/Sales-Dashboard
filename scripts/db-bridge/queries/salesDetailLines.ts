// Every non-cancelled SAP invoice and credit-note LINE, with the fields of the desktop "SAP B1 Detailed Sales Extraction"
// tool: header, billing account, U_CustomerName, item, warehouse, prices, paid amount, purchase price and cost centres.
// Sales amount (including the StockSum rule), signs and the sales-employee fallback (document, then line, then document
// owner) are that tool's. Read-only SELECT; callers pass a bounded window (one month at a time) to keep memory in check.
import sql from "mssql";
import type { SalesLineRecord } from "@/lib/salesLines";

/** A line as SAP returns it: everything stored except the principal, which is resolved from the item and warehouse. */
export type SapSalesDetailLine = Omit<SalesLineRecord, "principal">;

interface SalesDetailRecord {
  DocType: "INVOICE" | "CREDIT_NOTE";
  DocEntry: number;
  LineNum: number;
  DocNum: number;
  DocDate: Date;
  DocStatus: string;
  Printed: string | null;
  SeriesName: string | null;
  CardCode: string;
  CardName: string | null;
  SfaName: string | null;
  Phone: string | null;
  NumAtCard: string | null;
  Comments: string | null;
  SalesEmployee: string;
  ItemCode: string;
  ItemName: string | null;
  Quantity: number;
  InventoryQty: number;
  PackSize: number | null;
  WhsCode: string | null;
  WhsName: string | null;
  PriceBefDi: number | null;
  Price: number | null;
  DiscPrcnt: number | null;
  VatSum: number | null;
  SalesAmount: number | null;
  PaidSum: number | null;
  UnitCost: number | null;
  CreatedBy: string | null;
  CreateDate: Date | null;
  OcrCode: string | null;
  OcrCode2: string | null;
  OcrCode3: string | null;
}

const NO_REP = "'-No Sales Employee-'";
const clean = (expression: string) => `NULLIF(NULLIF(LTRIM(RTRIM(CAST(${expression} AS NVARCHAR(200)))), ''), ${NO_REP})`;
const SALES_EMPLOYEE = `COALESCE(${clean("T7.SlpName")}, ${clean("T8.SlpName")}, ${clean("ISNULL(T9.firstName, '') + ' ' + ISNULL(T9.lastName, '')")}, ${NO_REP})`;

const SALES_AMOUNT = {
  INVOICE: "CASE WHEN T0.isIns = 'N' AND T1.LineTotal > T1.StockSum AND T1.StockSum <> 0 THEN T1.StockSum ELSE T1.LineTotal END",
  CREDIT_NOTE: "CASE WHEN T1.StockSum = 0 THEN -T1.LineTotal ELSE -T1.StockSum END",
};

function documentSelect(docType: "INVOICE" | "CREDIT_NOTE"): string {
  const [header, line] = docType === "INVOICE" ? ["OINV", "INV1"] : ["ORIN", "RIN1"];
  const sign = docType === "INVOICE" ? "" : "-";
  return `
      SELECT
          '${docType}' AS DocType, T0.DocEntry, T1.LineNum, T0.DocNum, T0.TaxDate AS DocDate, T0.DocStatus, T0.Printed, T6.SeriesName,
          T0.CardCode, T0.CardName, T0.U_CustomerName AS SfaName, T5.Phone1 AS Phone, T0.NumAtCard, T0.Comments,
          ${SALES_EMPLOYEE} AS SalesEmployee,
          T1.ItemCode, T2.ItemName,
          ${sign}T1.Quantity AS Quantity,
          ${sign}CASE WHEN ISNULL(T1.InvQty, 0) <> 0 THEN T1.InvQty ELSE T1.Quantity END AS InventoryQty,
          T2.NumInBuy AS PackSize, T1.WhsCode, T3.WhsName, T1.PriceBefDi, T1.Price,
          ${sign}T1.DiscPrcnt AS DiscPrcnt, ${sign}T1.VatSum AS VatSum,
          ${SALES_AMOUNT[docType]} AS SalesAmount,
          T0.PaidSum, PL.PurchasePrice AS UnitCost, T4.U_NAME AS CreatedBy, T0.CreateDate, T1.OcrCode, T1.OcrCode2, T1.OcrCode3
      FROM ${header} T0
      INNER JOIN ${line} T1 ON T0.DocEntry = T1.DocEntry
      INNER JOIN OITM T2 ON T2.ItemCode = T1.ItemCode
      LEFT JOIN OWHS T3 ON T3.WhsCode = T1.WhsCode
      LEFT JOIN OUSR T4 ON T0.UserSign = T4.USERID
      LEFT JOIN OCRD T5 ON T0.CardCode = T5.CardCode
      LEFT JOIN NNM1 T6 ON T0.Series = T6.Series
      LEFT JOIN OSLP T7 ON T7.SlpCode = T0.SlpCode
      LEFT JOIN OSLP T8 ON T8.SlpCode = T1.SlpCode
      LEFT JOIN OHEM T9 ON T9.empID = T0.OwnerCode
      LEFT JOIN PurchasePrices PL ON PL.ItemCode = T1.ItemCode
      WHERE T0.CANCELED = 'N' AND T0.TaxDate BETWEEN @StartDate AND @EndDate`;
}

export const SALES_DETAIL_SQL = `
      WITH PurchasePrices AS (
          SELECT P1.ItemCode, MAX(P1.Price) / 1.16 AS PurchasePrice
          FROM ITM1 P1
          INNER JOIN OPLN P2 ON P1.PriceList = P2.ListNum
          WHERE P1.Price > 0 AND P2.ListName = 'Purchase Price'
          GROUP BY P1.ItemCode
      )
${documentSelect("INVOICE")}
      UNION ALL
${documentSelect("CREDIT_NOTE")};`;

const text = (value: string | null | undefined) => value?.trim() || null;
const num = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value));
const ymd = (value: Date) => value.toISOString().slice(0, 10);

export function toSalesDetailLine(r: SalesDetailRecord): SapSalesDetailLine {
  return {
    docType: r.DocType,
    docEntry: r.DocEntry,
    lineNum: r.LineNum,
    docNum: String(r.DocNum),
    docDate: ymd(r.DocDate),
    docStatus: r.DocStatus,
    printed: r.Printed === "Y",
    seriesName: text(r.SeriesName),
    cardCode: r.CardCode,
    customerName: r.CardName?.trim() ?? "",
    sfaName: text(r.SfaName),
    phone: text(r.Phone),
    numAtCard: text(r.NumAtCard),
    remarks: text(r.Comments),
    salesEmployee: r.SalesEmployee.trim(),
    itemCode: r.ItemCode,
    itemName: r.ItemName?.trim() || "(Unspecified product)",
    quantity: Number(r.Quantity),
    inventoryQty: Number(r.InventoryQty),
    packSize: r.PackSize && r.PackSize > 0 ? Number(r.PackSize) : null,
    whsCode: r.WhsCode,
    whsName: text(r.WhsName),
    priceBeforeDiscount: num(r.PriceBefDi),
    price: num(r.Price),
    discountPct: num(r.DiscPrcnt),
    vatAmount: Number(r.VatSum ?? 0),
    salesAmount: Number(r.SalesAmount ?? 0),
    paidAmount: Number(r.PaidSum ?? 0),
    unitCost: num(r.UnitCost),
    createdBy: text(r.CreatedBy),
    creationDate: r.CreateDate ? ymd(r.CreateDate) : null,
    costCentre1: text(r.OcrCode),
    costCentre2: text(r.OcrCode2),
    costCentre3: text(r.OcrCode3),
  };
}

export async function fetchSalesDetailLines(pool: sql.ConnectionPool, startDate: Date, endDate: Date): Promise<SapSalesDetailLine[]> {
  const result = await pool.request().input("StartDate", sql.Date, startDate).input("EndDate", sql.Date, endDate).query<SalesDetailRecord>(SALES_DETAIL_SQL);
  return result.recordset.map(toSalesDetailLine);
}

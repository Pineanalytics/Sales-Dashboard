// Stock receipts from SAP's stock ledger (OINM): the movements that bring stock in from a supplier or send it back. Read from OINM rather than the document tables because
// it gives one signed quantity in a single unit (pieces) whatever unit the document line used (cartons or pieces), carries the supplier and warehouse on every row, and its
// values equal the goods-receipt lines (checked against PDN1). A cancelled document posts its own reversing rows, so it nets to nothing. SELECT only.
import sql from "mssql";
import { SAP_TRANS_TYPES } from "@/lib/purchaseReceipts/types";

export interface PurchaseReceiptSapRow {
  transType: number;
  docEntry: number;
  docNum: string;
  docDate: Date;
  supplierCode: string;
  supplierName: string;
  itemCode: string;
  itemName: string;
  whsCode: string;
  /** In minus out, in the item's inventory unit (pieces). */
  qty: number;
  /** Cost value excl. VAT as SAP posted it to stock. */
  value: number;
}

interface SapRecord {
  TransType: number;
  DocEntry: number;
  DocNum: string | null;
  DocDate: Date;
  CardCode: string | null;
  CardName: string | null;
  ItemCode: string;
  ItemName: string | null;
  Warehouse: string;
  Qty: number;
  Value: number;
}

export async function fetchPurchaseReceipts(pool: sql.ConnectionPool, start: string, end: string): Promise<PurchaseReceiptSapRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, start)
    .input("EndDate", sql.Date, end)
    .query<SapRecord>(`
      SELECT
          M.TransType AS TransType,
          M.CreatedBy AS DocEntry,
          MAX(M.BASE_REF) AS DocNum,
          M.DocDate AS DocDate,
          COALESCE(NULLIF(LTRIM(RTRIM(M.CardCode)), ''), '(none)') AS CardCode,
          MAX(COALESCE(NULLIF(LTRIM(RTRIM(M.CardName)), ''), '(No supplier)')) AS CardName,
          M.ItemCode AS ItemCode,
          MAX(COALESCE(NULLIF(LTRIM(RTRIM(I.ItemName)), ''), M.Dscription)) AS ItemName,
          M.Warehouse AS Warehouse,
          SUM(M.InQty - M.OutQty) AS Qty,
          SUM(M.TransValue) AS Value
      FROM OINM M
      LEFT JOIN OITM I ON I.ItemCode = M.ItemCode
      WHERE M.TransType IN (${SAP_TRANS_TYPES.join(", ")})
        AND M.DocDate BETWEEN @StartDate AND @EndDate
      GROUP BY M.TransType, M.CreatedBy, M.DocDate, COALESCE(NULLIF(LTRIM(RTRIM(M.CardCode)), ''), '(none)'), M.ItemCode, M.Warehouse
    `);
  return result.recordset.map((r) => ({
    transType: r.TransType,
    docEntry: r.DocEntry,
    docNum: r.DocNum?.trim() || String(r.DocEntry),
    docDate: r.DocDate,
    supplierCode: r.CardCode ?? "(none)",
    supplierName: r.CardName ?? "(No supplier)",
    itemCode: r.ItemCode,
    itemName: r.ItemName?.trim() || "(Unspecified product)",
    whsCode: r.Warehouse,
    qty: Number(r.Qty ?? 0),
    value: Number(r.Value ?? 0),
  }));
}

/** The goods-receipt documents' own total for a window (PDN1 line totals of documents that are not cancelled), to check the stock ledger's figure against. */
export async function fetchGoodsReceiptDocumentTotal(pool: sql.ConnectionPool, start: string, end: string): Promise<{ docs: number; value: number }> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, start)
    .input("EndDate", sql.Date, end)
    .query<{ Docs: number; Value: number | null }>(`
      SELECT COUNT(DISTINCT T0.DocEntry) AS Docs, SUM(T1.LineTotal) AS Value
      FROM OPDN T0 INNER JOIN PDN1 T1 ON T0.DocEntry = T1.DocEntry
      WHERE T0.CANCELED = 'N' AND T0.DocDate BETWEEN @StartDate AND @EndDate
    `);
  return { docs: Number(result.recordset[0]?.Docs ?? 0), value: Number(result.recordset[0]?.Value ?? 0) };
}

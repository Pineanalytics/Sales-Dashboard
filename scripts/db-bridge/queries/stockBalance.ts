// Mirrors the "Stock_Balance" Power Query — an as-at-date snapshot at item+warehouse grain.
//
// As at TODAY (every live sync) it reads SAP's own running balance, OITW.OnHand and OITW.StockValue. For a past date it
// still adds up OINM, the inventory-movement ledger, which is what this query always did. The two agree: on 24 Nov 2026
// OITW matched the OINM sum on quantity for all 293,867 item-warehouse pairs, and on value for every pair but one, which
// differed by exactly one invoice line posted while the two were being read. They do not cost the same. The OINM sum reads
// the entire movement history (about 10.6 million page reads and 54 CPU-seconds on the SAP server, every 30 minutes),
// OITW a few thousand rows.
import sql from "mssql";

export interface StockBalanceRow {
  itemCode: string;
  itemName: string;
  itemGroup: string | null;
  brand: string | null;
  whsCode: string | null;
  whsName: string | null;
  onhandQty: number;
  avgPrice: number | null;
  stockValue: number;
}

interface StockBalanceRecord {
  ItemCode: string;
  ItemName: string;
  "Item Group": string | null;
  "Brand/Manufacturer": string | null;
  "Warehouse Code": string | null;
  WhsName: string | null;
  "Onhand/Available Qty": number;
  "Avg Price": number | null;
  "Stock Value": number;
}

/** True when the snapshot is "as at today (or later)", where SAP's running balance in OITW is the same figure the movement ledger adds up to. */
export function canUseRunningBalance(asOfDate: Date, now: Date = new Date()): boolean {
  return asOfDate.toISOString().slice(0, 10) >= now.toISOString().slice(0, 10);
}

const RUNNING_BALANCE_SQL = `
      SELECT
        T1."ItemCode",
        T1."ItemName",
        T3."ItmsGrpNam" AS "Item Group",
        T4."FirmName" AS "Brand/Manufacturer",
        T0."WhsCode" AS "Warehouse Code",
        T2."WhsName" AS "WhsName",
        COALESCE(T0."OnHand", 0) AS "Onhand/Available Qty",
        T0."StockValue" / NULLIF(T0."OnHand", 0) AS "Avg Price",
        COALESCE(T0."StockValue", 0) AS "Stock Value"
      FROM OITW T0
      INNER JOIN OITM T1 ON T0."ItemCode" = T1."ItemCode"
      LEFT OUTER JOIN OWHS T2 ON T0."WhsCode" = T2."WhsCode"
      LEFT OUTER JOIN OITB T3 ON T1."ItmsGrpCod" = T3."ItmsGrpCod"
      LEFT OUTER JOIN OMRC T4 ON T4."FirmCode" = T1."FirmCode"
      ORDER BY T1."ItemCode";
    `;

export async function fetchStockBalance(pool: sql.ConnectionPool, asOfDate: Date): Promise<StockBalanceRow[]> {
  const asAtDate = asOfDate.toISOString().slice(0, 10);

  const request = pool.request().input("AsAtDate", sql.Date, asAtDate);
  const result = canUseRunningBalance(asOfDate)
    ? await request.query<StockBalanceRecord>(RUNNING_BALANCE_SQL)
    : await request.query<StockBalanceRecord>(`
      WITH Movements AS (
        SELECT
          "ItemCode",
          "Warehouse" AS "Warehouse Code",
          SUM("InQty" - "OutQty") AS "Onhand/Available Qty",
          SUM("TransValue") AS "Stock Value"
        FROM OINM
        WHERE "DocDate" <= @AsAtDate
        GROUP BY "ItemCode", "Warehouse"
      )
      SELECT
        T1."ItemCode",
        T1."ItemName",
        T3."ItmsGrpNam" AS "Item Group",
        T4."FirmName" AS "Brand/Manufacturer",
        T0."WhsCode" AS "Warehouse Code",
        T2."WhsName" AS "WhsName",
        COALESCE(M."Onhand/Available Qty", 0) AS "Onhand/Available Qty",
        M."Stock Value" / NULLIF(M."Onhand/Available Qty", 0) AS "Avg Price",
        COALESCE(M."Stock Value", 0) AS "Stock Value"
      FROM OITW T0
      INNER JOIN OITM T1 ON T0."ItemCode" = T1."ItemCode"
      LEFT OUTER JOIN Movements M ON M."ItemCode" = T0."ItemCode" AND M."Warehouse Code" = T0."WhsCode"
      LEFT OUTER JOIN OWHS T2 ON T0."WhsCode" = T2."WhsCode"
      LEFT OUTER JOIN OITB T3 ON T1."ItmsGrpCod" = T3."ItmsGrpCod"
      LEFT OUTER JOIN OMRC T4 ON T4."FirmCode" = T1."FirmCode"
      ORDER BY T1."ItemCode";
    `);

  return result.recordset.map((r) => ({
    itemCode: r.ItemCode,
    itemName: r.ItemName,
    itemGroup: r["Item Group"],
    brand: r["Brand/Manufacturer"],
    whsCode: r["Warehouse Code"],
    whsName: r.WhsName,
    onhandQty: r["Onhand/Available Qty"] ?? 0,
    avgPrice: r["Avg Price"],
    stockValue: r["Stock Value"] ?? 0,
  }));
}

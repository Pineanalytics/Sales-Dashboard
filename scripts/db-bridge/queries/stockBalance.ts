// Mirrors the "Stock_Balance" Power Query — an as-at-date snapshot from OINM
// (inventory moves), grouped to item+warehouse grain. Verbatim T-SQL, no gaps.
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

export async function fetchStockBalance(pool: sql.ConnectionPool, asOfDate: Date): Promise<StockBalanceRow[]> {
  const asAtDate = asOfDate.toISOString().slice(0, 10);

  const result = await pool
    .request()
    .input("AsAtDate", sql.Date, asAtDate)
    .query<StockBalanceRecord>(`
      SELECT
          T1."ItemCode",
          T1."ItemName",
          T3."ItmsGrpNam" AS "Item Group",
          T4."FirmName" AS "Brand/Manufacturer",
          MAX(T0."Warehouse") AS "Warehouse Code",
          T2."WhsName" AS "WhsName",
          SUM(T0."InQty" - T0."OutQty") AS "Onhand/Available Qty",
          SUM(T0."TransValue") / NULLIF(SUM(T0."InQty" - T0."OutQty"), 0) AS "Avg Price",
          SUM(T0."TransValue") AS "Stock Value"
      FROM OINM T0
      INNER JOIN OITM T1
          ON T0."ItemCode" = T1."ItemCode"
      LEFT OUTER JOIN OWHS T2
          ON T0."Warehouse" = T2."WhsCode"
      LEFT OUTER JOIN OITB T3
          ON T1."ItmsGrpCod" = T3."ItmsGrpCod"
      LEFT OUTER JOIN OMRC T4
          ON T4."FirmCode" = T1."FirmCode"
      WHERE
          T0."DocDate" <= @AsAtDate
      GROUP BY
          T1."ItemCode",
          T1."ItemName",
          T2."WhsName",
          T3."ItmsGrpNam",
          T4."FirmName"
      HAVING
          SUM(T0."InQty" - T0."OutQty") <> 0
      ORDER BY
          T1."ItemCode";
    `);

  return result.recordset.map((r) => ({
    itemCode: r.ItemCode,
    itemName: r.ItemName,
    itemGroup: r["Item Group"],
    brand: r["Brand/Manufacturer"],
    whsCode: r["Warehouse Code"],
    whsName: r.WhsName,
    onhandQty: r["Onhand/Available Qty"],
    avgPrice: r["Avg Price"],
    stockValue: r["Stock Value"],
  }));
}

// Demand side of the direct Stock feed. Mirrors the Standard Stock Power Query's
// SQL stage, at Item x Warehouse grain: invoice quantity/value less credit-note
// returns, aggregated to daily first so later transforms can calculate a stable
// selling-day run rate without hauling a transaction-level dataset into Node.
import sql from "mssql";

export interface StandardStockDemandRow {
  itemCode: string;
  warehouseCode: string;
  itemName: string;
  quantityUnits: number;
  sumQuantitySquared: number;
  salesValue: number;
  sellingDays: number;
  firstSale: Date;
  lastSale: Date;
}

interface StandardStockDemandRecord {
  "Item Code": string;
  "Warehouse Code": string;
  "Item Name": string;
  "Qty Units": number;
  "Sum Qty Sq": number;
  "Sales Value": number;
  "Selling Days": number;
  "First Sale": Date;
  "Last Sale": Date;
}

/** Fetches year-to-date demand. The transformation owns the Nairobi selling-day
 * calendar and new-item prorating so those business rules remain explicit and
 * testable rather than hidden inside a server-specific SQL calendar. */
export async function fetchStandardStockDemand(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date
): Promise<StandardStockDemandRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.Date, startDate.toISOString().slice(0, 10))
    .input("EndDate", sql.Date, endDate.toISOString().slice(0, 10))
    .query<StandardStockDemandRecord>(`
      WITH Lines AS (
        SELECT
          T1."ItemCode" AS ItemCode,
          T1."WhsCode" AS WhsCode,
          T0."TaxDate" AS D,
          CASE WHEN T1."InvQty" <> 0 THEN T1."InvQty" ELSE T1."Quantity" END AS Q,
          CASE
            WHEN T0."isIns" = 'N' AND T1."LineTotal" > T1."StockSum" AND T1."StockSum" <> 0
            THEN T1."StockSum"
            ELSE T1."LineTotal"
          END AS Val
        FROM OINV T0
        INNER JOIN INV1 T1 ON T0."DocEntry" = T1."DocEntry"
        WHERE T0."CANCELED" = 'N'
          AND T0."TaxDate" BETWEEN @StartDate AND @EndDate

        UNION ALL

        SELECT
          T1."ItemCode",
          T1."WhsCode",
          T0."TaxDate",
          -(CASE WHEN T1."InvQty" <> 0 THEN T1."InvQty" ELSE T1."Quantity" END),
          CASE WHEN T1."StockSum" = 0 THEN -T1."LineTotal" ELSE -T1."StockSum" END
        FROM ORIN T0
        INNER JOIN RIN1 T1 ON T0."DocEntry" = T1."DocEntry"
        WHERE T0."CANCELED" = 'N'
          AND T0."TaxDate" BETWEEN @StartDate AND @EndDate
      ),
      Daily AS (
        SELECT ItemCode, WhsCode, D, SUM(Q) AS DayQty, SUM(Val) AS DayVal
        FROM Lines
        GROUP BY ItemCode, WhsCode, D
      )
      SELECT
        DL.ItemCode AS "Item Code",
        DL.WhsCode AS "Warehouse Code",
        OI."ItemName" AS "Item Name",
        SUM(DL.DayQty) AS "Qty Units",
        SUM(DL.DayQty * DL.DayQty) AS "Sum Qty Sq",
        SUM(DL.DayVal) AS "Sales Value",
        COUNT(*) AS "Selling Days",
        MIN(DL.D) AS "First Sale",
        MAX(DL.D) AS "Last Sale"
      FROM Daily DL
      INNER JOIN OITM OI ON OI."ItemCode" = DL.ItemCode
      GROUP BY DL.ItemCode, DL.WhsCode, OI."ItemName";
    `);

  return result.recordset.map((row) => ({
    itemCode: row["Item Code"],
    warehouseCode: row["Warehouse Code"],
    itemName: row["Item Name"],
    quantityUnits: row["Qty Units"],
    sumQuantitySquared: row["Sum Qty Sq"],
    salesValue: row["Sales Value"],
    sellingDays: row["Selling Days"],
    firstSale: row["First Sale"],
    lastSale: row["Last Sale"],
  }));
}

// P&L by Cost Centre — user-supplied T-SQL (converted from Crystal Reports),
// verbatim except for dynamic @StartDate/@EndDate instead of the original
// hardcoded literals. Pulls detail-level journal-entry lines from OJDT/JDT1,
// classified into REVENUE/COGS/EXPENSE/OTHER_INCOME by account-code prefix.
// Only DETAIL rows come from SQL — Gross Profit/Total Income/Net Profit are
// computed downstream (lib/timeIntelligence.ts's summarizePLForPeriod), never
// baked in here, so the fact table stays additive across any slice.
import sql from "mssql";

export type PLLineType = "REVENUE" | "COGS" | "EXPENSE" | "OTHER_INCOME";

export interface PLRawRow {
  docNum: number;
  cardName: string | null;
  docTotal: number;
  docEntry: number;
  description: string | null;
  docDate: Date;
  costCenter: string;
  accountCode: string;
  accountName: string;
  lineType: PLLineType;
}

interface PLRecord {
  DocNum: number;
  CardName: string | null;
  DocTotal: number;
  DocEntry: number;
  Dscription: string | null;
  DocDate: Date;
  CostCenter: string;
  AccountCode: string;
  AccountName: string;
  TYPE: string;
}

export async function fetchPLByCostCentre(pool: sql.ConnectionPool, startDate: Date, endDate: Date): Promise<PLRawRow[]> {
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  const result = await pool
    .request()
    .input("StartDate", sql.Date, start)
    .input("EndDate", sql.Date, end)
    .query<PLRecord>(`
      -- One pass over the journal lines for the year. This used to be four UNION ALL branches (revenue, COGS, expense,
      -- other income), each re-reading OJDT/JDT1 for the whole year, so every 30-minute run scanned the SAP general ledger
      -- four times. The prefixes below do not overlap, so each line belongs to exactly one branch and the rows are the same.
      WITH Base AS (
          SELECT
              T0.TransId      AS DocNum,
              'JE'            AS DocType,
              'N'             AS CANCELED,
              T0.Memo         AS CardName,
              CASE WHEN T1.Account LIKE '401%' OR T1.Account LIKE '41%'
                   THEN (T1.Credit - T1.Debit)
                   ELSE (T1.Debit - T1.Credit)
              END             AS DocTotal,
              T0.TransId      AS DocEntry,
              T1.LineMemo     AS Dscription,
              T0.RefDate      AS DocDate,
              ISNULL(T1.ProfitCode,'Unassigned') AS CostCenter,
              T1.Account      AS AccountCode,
              ISNULL(Ac1.AcctName,'') AS AccountName,
              CASE
                  WHEN T1.Account LIKE '401%' THEN 'REVENUE'
                  WHEN T1.Account LIKE '5%'   THEN 'COGS'
                  WHEN T1.Account LIKE '41%'  THEN 'OTHER INCOME'
                  ELSE 'EXPENSE'
              END             AS TYPE
          FROM OJDT T0
          INNER JOIN JDT1 T1 ON T0.TransId = T1.TransId
          LEFT JOIN OACT Ac1 ON T1.Account = Ac1.AcctCode
          WHERE T0.RefDate BETWEEN @StartDate AND @EndDate
            AND (T1.Account LIKE '401%' OR T1.Account LIKE '5%' OR T1.Account LIKE '6%' OR T1.Account LIKE '7%' OR T1.Account LIKE '41%')
      )

      SELECT
          DocNum, DocType, CANCELED, CardName, DocTotal, DocEntry,
          Dscription, DocDate, CostCenter, AccountCode, AccountName, TYPE
      FROM Base
      WHERE CANCELED = 'N'
      ORDER BY DocDate DESC;
    `);

  return result.recordset.map((r) => ({
    docNum: r.DocNum,
    cardName: r.CardName,
    docTotal: r.DocTotal,
    docEntry: r.DocEntry,
    description: r.Dscription,
    docDate: new Date(r.DocDate),
    costCenter: r.CostCenter,
    accountCode: r.AccountCode,
    accountName: r.AccountName,
    // Source TYPE is "OTHER INCOME" (with a space); normalize to match PLLineType.
    lineType: (r.TYPE === "OTHER INCOME" ? "OTHER_INCOME" : r.TYPE) as PLLineType,
  }));
}

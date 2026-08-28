// PJP/DSR daily activity — a fourth report against the same Centegy SQL
// Server as the other three (same connection, same run — see run.ts). Built
// from CASHMEMO.DATE_ENTRY, the handheld device's actual capture timestamp —
// NOT DELV_DATE/DOC_DATE, which were confirmed (by sampling live data) to
// always sit at exactly 00:00:00 and carry no real time-of-day signal at
// all. DATE_ENTRY does: real, varying times across the working day.
//
// Per-day fact grain like query.ts/outletSkuNetSalesQuery.ts (not a
// month-wide recompute) — delete-and-replace by delivery-date window.
//
// HHT_SRNO ('0' vs a real handheld sequence number, e.g. "_910_") is used as
// a data-quality signal: some PJPs consistently show '0' across all their
// transactions, meaning that route isn't actually using a handheld device —
// its DATE_ENTRY times likely reflect office/manual entry, not real field
// activity. handheldTransactionCount lets a consumer judge how much to trust
// a given row's timing rather than silently excluding that data.
import sql from "mssql";

export interface PjpDsrDailyActivityRow {
  date: string; // "YYYY-MM-DD" — the delivery date this activity belongs to
  pjp: string;
  route: string;
  dsr: string;
  dsrName: string;
  transactionCount: number;
  outletsVisited: number;
  handheldTransactionCount: number;
  firstEntryTime: string | null; // ISO timestamp
  lastEntryTime: string | null; // ISO timestamp
  activeSpanMinutes: number | null; // lastEntryTime - firstEntryTime
  avgGapMinutes: number | null; // average time between consecutive transactions that day
}

interface PjpDsrDailyActivityRecord {
  ActivityDate: Date;
  PJP: string;
  ROUTE: string;
  DSR: string;
  DSR_NAME: string;
  TRANSACTION_COUNT: number;
  OUTLETS_VISITED: number;
  HANDHELD_TRANSACTION_COUNT: number;
  FIRST_ENTRY_TIME: Date | null;
  LAST_ENTRY_TIME: Date | null;
  ACTIVE_SPAN_MINUTES: number | null;
  AVG_GAP_MINUTES: number | null;
}

/** Fetches PJP/DSR daily activity for [startDate, endDate] (inclusive),
 *  filtered on delivery date exactly like the other per-day reports. Bound
 *  callers to the sync's own day window. */
export async function fetchPjpDsrDailyActivity(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date
): Promise<PjpDsrDailyActivityRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .query<PjpDsrDailyActivityRecord>(`
      WITH OrderedEntries AS (
          SELECT
              CAST(c.DELV_DATE AS DATE) AS ActivityDate,
              c.PJP,
              c.DSR,
              c.COMPANY,
              c.DISTRIBUTOR,
              c.DATE_ENTRY,
              c.HHT_SRNO,
              c.town + c.locality + c.SLOCALITY + c.pop AS OutletCode,
              LAG(c.DATE_ENTRY) OVER (
                PARTITION BY CAST(c.DELV_DATE AS DATE), c.PJP, c.DSR
                ORDER BY c.DATE_ENTRY
              ) AS PrevEntryTime
          FROM CASHMEMO c
          WHERE c.DELV_DATE >= @StartDate AND c.DELV_DATE <= @EndDate
            AND c.VISIT_TYPE = '02'
      )
      SELECT
          oe.ActivityDate,
          oe.PJP,
          MAX(ph.LDESC) AS ROUTE,
          oe.DSR,
          MAX(ds.NAME) AS DSR_NAME,
          COUNT(*) AS TRANSACTION_COUNT,
          COUNT(DISTINCT oe.OutletCode) AS OUTLETS_VISITED,
          SUM(CASE WHEN oe.HHT_SRNO IS NOT NULL AND oe.HHT_SRNO <> '0' THEN 1 ELSE 0 END) AS HANDHELD_TRANSACTION_COUNT,
          MIN(oe.DATE_ENTRY) AS FIRST_ENTRY_TIME,
          MAX(oe.DATE_ENTRY) AS LAST_ENTRY_TIME,
          DATEDIFF(MINUTE, MIN(oe.DATE_ENTRY), MAX(oe.DATE_ENTRY)) AS ACTIVE_SPAN_MINUTES,
          AVG(CASE WHEN oe.PrevEntryTime IS NOT NULL THEN DATEDIFF(MINUTE, oe.PrevEntryTime, oe.DATE_ENTRY) END) AS AVG_GAP_MINUTES
      FROM OrderedEntries oe
      INNER JOIN PJP_HEAD ph ON ph.PJP = oe.PJP
      INNER JOIN DSR ds ON ds.COMPANY = oe.COMPANY AND ds.DISTRIBUTOR = oe.DISTRIBUTOR AND ds.DSR = oe.DSR
      GROUP BY oe.ActivityDate, oe.PJP, oe.DSR, oe.COMPANY, oe.DISTRIBUTOR
    `);

  return result.recordset.map((r) => ({
    date: r.ActivityDate.toISOString().slice(0, 10),
    pjp: r.PJP,
    route: r.ROUTE,
    dsr: r.DSR,
    dsrName: r.DSR_NAME,
    transactionCount: r.TRANSACTION_COUNT,
    outletsVisited: r.OUTLETS_VISITED,
    handheldTransactionCount: r.HANDHELD_TRANSACTION_COUNT,
    firstEntryTime: r.FIRST_ENTRY_TIME ? r.FIRST_ENTRY_TIME.toISOString() : null,
    lastEntryTime: r.LAST_ENTRY_TIME ? r.LAST_ENTRY_TIME.toISOString() : null,
    activeSpanMinutes: r.ACTIVE_SPAN_MINUTES,
    avgGapMinutes: r.AVG_GAP_MINUTES,
  }));
}

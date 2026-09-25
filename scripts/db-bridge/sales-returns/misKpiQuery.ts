// Centegy's own pre-computed PJP KPI values — a seventh report against the
// same Centegy SQL Server as query.ts/pjpSkuQuery.ts/journeyPlanQuery.ts
// (same connection, same run — see run.ts), added 2026-09-25 after
// discovering Centegy already computes ECO/Billing Productivity/LPPC
// natively (its "FCS6" scoring module) and attempts a real geofence check
// (its "EDGC" EFOS module) — see lib/unileverKpi.ts, which now reads these
// instead of deriving ECO/BP/LPPC by hand from SalesReturnLine/
// JourneyPlanAssignment/VisitSummaryRecord joins.
//
// MIS_KPI_DATA is a generic EAV store: one row per (COMPANY, YEAR, JCNO,
// DISTRIBUTOR, PJP, KPI_ID). "JCNO" is Centegy's "journey cycle" number —
// confirmed via JC_WEEK's own date ranges to equal the calendar month
// (01-12) despite JC_WEEK's name; each JCNO splits into several weekly
// sub-rows purely for day-grain KPIs, which the FCS6* scoring KPIs below
// don't use (one row per JCNO, no day component). The EDGC geofence KPIs
// (EDGCR01/02) are the opposite — Centegy only ever logs them per day, never
// aggregated to the month — so this module sums them itself into a
// month-to-date rollup, tagged with synthetic (non-Centegy) KPI_ID keys.
//
// Not date-windowed like the per-day reports — always fetch one exact
// (year, jcno), current and prior (see run.ts), and replace that exact
// distributor/pjp/year/jcno partition (see /api/mis-kpi/upload).
import sql from "mssql";

// Every deployment sampled so far (Nairobi, Nyeri) uses this SAP-style
// company code across POP/CASHMEMO/MIS_KPI/DSR — same assumption as
// VISIT_TYPE = '02' elsewhere in this bridge.
const COMPANY = "02";

// Centegy's own catalog codes, taken as-is (MIS_KPI.LDESC given inline below
// for readability — must match what MIS_KPI actually has, confirmed
// 2026-09-25 on Nairobi).
const PASS_THROUGH_KPI_IDS = [
  "FCS6ECR1", // Eco No. Of Active Outlets (ECO universe)
  "FCS6ECR2", // Eco ECO Actual (outlets achieved)
  "FCS6ECR3", // Eco ECO Percentage %
  "FCS6ECR4", // Eco ECO Target %
  "FCS6ECR5", // Eco Actual ECO Achieved
  "FCS6ECR6", // Eco ECO Score
  "FCS6BPR1", // Bill Productivity Number Of Call to be Visited (BP universe)
  "FCS6BPR2", // Bill Productivity Total Number Of Invoices (BP actual)
  "FCS6BPR3", // Bill Productivity BP Percentage %
  "FCS6BPR4", // Bill Productivity BP Target %
  "FCS6BPR5", // Bill Productivity Total BP Target Invoice
  "FCS6BPR6", // Bill Productivity Actual BP Achieved
  "FCS6BPR7", // Bill Productivity BP Score
  "FCS6LPR1", // line Per Productive call SKU Total Line Count
  "FCS6LPR2", // line Per Productive call SKU Ach Line Count
  "FCS6LPR3", // line Per Productive call LPPC Target
  "FCS6LPR4", // line Per Productive call Total No. OF Line Score
  "FCS6LPR5", // line Per Productive call LPPC Ach/LPPC Tgt (achievement ratio %)
  "FCS6LPR6", // line Per Productive call LPPC Score
];

export interface MisKpiValueRow {
  distributor: string;
  pjp: string;
  year: string;
  jcno: string;
  kpiId: string;
  kpiDesc: string;
  value: number;
}

interface CurrentJcRecord {
  YEAR: string;
  JCNO: string;
}

/** Resolves the (year, jcno) whose JC_WEEK date range contains this
 * distributor's current working date — same lookup as the vendor's own
 * "EFOS PJP Wise Report" (Curr_Calnd dataset). Returns null if the
 * distributor has no JC_WEEK row covering today (shouldn't happen for an
 * active branch, but the calendar table is admin-maintained). */
export async function fetchCurrentJc(pool: sql.ConnectionPool, distributor: string): Promise<{ year: string; jcno: string } | null> {
  const result = await pool
    .request()
    .input("Company", sql.VarChar, COMPANY)
    .input("Distributor", sql.VarChar, distributor)
    .query<CurrentJcRecord>(`
      SELECT DISTINCT YEAR, JCNO FROM JC_WEEK
      WHERE (SELECT TOP 1 WORKING_DATE FROM DISTRIBUTOR WHERE COMPANY = @Company AND DISTRIBUTOR = @Distributor) BETWEEN START_DATE AND END_DATE
    `);
  const row = result.recordset[0];
  return row ? { year: row.YEAR, jcno: row.JCNO } : null;
}

/** The JC immediately before the given one — JCNO is the calendar month
 * (01-12), so this just steps back a month, rolling the year at January. */
export function priorJc({ year, jcno }: { year: string; jcno: string }): { year: string; jcno: string } {
  const monthIndex = Number(jcno);
  if (monthIndex <= 1) return { year: String(Number(year) - 1), jcno: "12" };
  return { year, jcno: String(monthIndex - 1).padStart(2, "0") };
}

interface PassThroughRecord {
  PJP: string;
  KPI_ID: string;
  KPI_DESC: string;
  VALUE: number;
}

interface GeoAggregateRecord {
  PJP: string;
  SCHEDULED: number;
  MATCHED: number;
}

/** Fetches Centegy's own pre-computed KPI values for one exact
 * (distributor, year, jcno), across every PJP on that distributor. */
export async function fetchMisKpiValues(pool: sql.ConnectionPool, distributor: string, year: string, jcno: string): Promise<MisKpiValueRow[]> {
  const idList = PASS_THROUGH_KPI_IDS.map((id) => `'${id}'`).join(",");
  const passThrough = await pool
    .request()
    .input("Company", sql.VarChar, COMPANY)
    .input("Distributor", sql.VarChar, distributor)
    .input("Year", sql.VarChar, year)
    .input("Jcno", sql.VarChar, jcno)
    .query<PassThroughRecord>(`
      SELECT MKD.COLUMN05 AS PJP, MKD.COLUMN01 AS KPI_ID, MK.LDESC AS KPI_DESC, MKD.KPI_RETURN_VALUE AS VALUE
      FROM MIS_KPI_DATA MKD
      INNER JOIN MIS_KPI MK ON MK.COMPANY = MKD.COMPANY AND MK.KPI_ID = MKD.KPI_ID
      WHERE MKD.COMPANY = @Company AND MKD.COLUMN04 = @Distributor
        AND MKD.COLUMN02 = @Year AND MKD.COLUMN03 = @Jcno
        AND MKD.COLUMN01 IN (${idList})
    `);

  const geo = await pool
    .request()
    .input("Company", sql.VarChar, COMPANY)
    .input("Distributor", sql.VarChar, distributor)
    .input("Year", sql.VarChar, year)
    .input("Jcno", sql.VarChar, jcno)
    .query<GeoAggregateRecord>(`
      SELECT MKD.COLUMN05 AS PJP,
        SUM(CASE WHEN MKD.COLUMN01 = 'EDGCR01' THEN MKD.KPI_RETURN_VALUE ELSE 0 END) AS SCHEDULED,
        SUM(CASE WHEN MKD.COLUMN01 = 'EDGCR02' THEN MKD.KPI_RETURN_VALUE ELSE 0 END) AS MATCHED
      FROM MIS_KPI_DATA MKD
      WHERE MKD.COMPANY = @Company AND MKD.COLUMN04 = @Distributor
        AND MKD.COLUMN02 = @Year AND MKD.COLUMN03 = @Jcno
        AND MKD.COLUMN01 IN ('EDGCR01', 'EDGCR02')
      GROUP BY MKD.COLUMN05
    `);

  const rows: MisKpiValueRow[] = passThrough.recordset.map((r) => ({
    distributor,
    pjp: r.PJP,
    year,
    jcno,
    kpiId: r.KPI_ID,
    kpiDesc: r.KPI_DESC,
    value: r.VALUE,
  }));

  for (const r of geo.recordset) {
    rows.push({ distributor, pjp: r.PJP, year, jcno, kpiId: "GEOCODE_SCHEDULED_MTD", kpiDesc: "Geo Code scheduled outlets (MTD sum of EDGCR01)", value: r.SCHEDULED });
    rows.push({ distributor, pjp: r.PJP, year, jcno, kpiId: "GEOCODE_MATCHED_MTD", kpiDesc: "Geo Code matched outlets (MTD sum of EDGCR02)", value: r.MATCHED });
    rows.push({
      distributor,
      pjp: r.PJP,
      year,
      jcno,
      kpiId: "GEOCODE_MATCHED_PCT_MTD",
      kpiDesc: "Geo Code matched % (MTD, our own rollup)",
      value: r.SCHEDULED > 0 ? Math.round((r.MATCHED / r.SCHEDULED) * 1000) / 10 : 0,
    });
  }

  return rows;
}

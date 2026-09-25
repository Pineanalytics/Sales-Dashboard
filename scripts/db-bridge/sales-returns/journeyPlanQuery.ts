// Outlet-to-PJP roster — a fifth report against the same Centegy SQL Server
// as query.ts/pjpSkuQuery.ts/outletSkuNetSalesQuery.ts (same connection, same
// run — see run.ts), added 2026-09-25 to resolve the Unilever KPI card's ECO
// (Coverage) and Perfect Assortment denominators (lib/unileverKpi.ts): every
// other Sales & Returns table only ever carries an outlet once it has
// transacted, so none of them can answer "which outlets does this PJP own".
// IG_I_JourneyPlan is Centegy's live journey-plan-cycle table — a customer
// recurs once per week of its visit cycle, so this query GROUPs down to one
// row per (distributor, pjp, customerCode) rather than mirroring that full
// weekly grain, since the KPI card only needs "is this outlet assigned to
// this PJP". Not date-windowed like the other reports — always fetch the
// whole current distributor roster and replace it in full (see
// /api/journey-plan/upload).
import sql from "mssql";

export interface JourneyPlanAssignmentRow {
  distributor: string;
  pjp: string;
  routeDesc: string;
  customerCode: string;
  sequenceDay: number | null;
  workingDay: number | null;
}

interface JourneyPlanAssignmentRecord {
  DISTRIBUTOR: string;
  PJP: string;
  ROUTE_DESC: string;
  CUSTOMER_CODE: string;
  SEQUENCE_DAY: number | null;
  WORKING_DAY: number | null;
}

/** Fetches the current outlet roster for every PJP on one distributor.
 * CustomerCode comes back "~"-separated (e.g. "T0045~002~001~00053787");
 * normalized here to plain concatenation to match
 * SalesReturnLine.customerCode / OutletSkuDailySales.outletCode. */
export async function fetchJourneyPlanAssignments(pool: sql.ConnectionPool, distributor: string): Promise<JourneyPlanAssignmentRow[]> {
  const result = await pool
    .request()
    .input("Distributor", sql.VarChar, distributor)
    .query<JourneyPlanAssignmentRecord>(`
      SELECT
        LocationCode AS DISTRIBUTOR,
        JourneyPlanCode AS PJP,
        MAX(JourneyPlanDescription) AS ROUTE_DESC,
        CustomerCode AS CUSTOMER_CODE,
        MIN(SequenceDay) AS SEQUENCE_DAY,
        MAX(WorkingDay) AS WORKING_DAY
      FROM IG_I_JourneyPlan
      WHERE LocationCode = @Distributor
      GROUP BY LocationCode, JourneyPlanCode, CustomerCode
    `);

  return result.recordset.map((r) => ({
    distributor: r.DISTRIBUTOR,
    pjp: r.PJP,
    routeDesc: r.ROUTE_DESC,
    customerCode: r.CUSTOMER_CODE.replace(/~/g, ""),
    sequenceDay: r.SEQUENCE_DAY,
    workingDay: r.WORKING_DAY,
  }));
}

// Outlet visit log — a sixth report against the same Centegy SQL Server as
// query.ts/pjpSkuQuery.ts/outletSkuNetSalesQuery.ts (same connection, same
// run — see run.ts), added 2026-09-25 to resolve the Unilever KPI card's
// Billing Productivity denominator (lib/unileverKpi.ts): every other Sales &
// Returns table only ever carries a "call" that produced a CASHMEMO
// document, so none of them can distinguish a productive call from an
// attempted-but-unbilled one. IG_O_VisitSummary logs the handheld device's
// visit regardless of billing outcome. Per-day fact grain like
// query.ts/outletSkuNetSalesQuery.ts — pass the sync's own [start, end]
// window, delete-and-replace on upload (see /api/visit-summary/upload).
//
// StartGeoCodeX/Y map to longitude/latitude respectively (GIS X/Y
// convention, matching every other GeoCodeX/Y pair across this schema —
// e.g. IG_I_Customer, Bck_IG_O_CustomerGeoCode). Confirmed on both branches
// (2026-09-25) that Centegy isn't writing real device GPS here: null on
// every sampled Nyeri row, and a literal (0, 0) -- "null island", nowhere
// near Kenya -- on every sampled Nairobi row. Both are treated as "no GPS"
// and normalized to null below, so a future maintainer doesn't mistake
// (0, 0) for a real reading once/if this ever starts being written.
import sql from "mssql";

export interface VisitSummaryRow {
  distributor: string;
  route: string;
  transactionDate: string; // "YYYY-MM-DD"
  visitSequence: number;
  customerCode: string;
  visitStartAt: string; // ISO timestamp
  visitEndAt: string; // ISO timestamp
  startLatitude: number | null;
  startLongitude: number | null;
}

interface VisitSummaryRecord {
  DISTRIBUTOR: string;
  ROUTE: string;
  TRANSACTION_DATE: Date;
  VISIT_SEQUENCE: number;
  CUSTOMER_CODE: string;
  VISIT_START: Date;
  VISIT_END: Date;
  GEO_X: number | null;
  GEO_Y: number | null;
}

/** Fetches visit-log rows for [startDate, endDate] (inclusive), filtered on
 * TransactionDate exactly like the other per-day Sales & Returns reports. */
export async function fetchVisitSummary(
  pool: sql.ConnectionPool,
  startDate: Date,
  endDate: Date,
  distributor: string
): Promise<VisitSummaryRow[]> {
  const result = await pool
    .request()
    .input("StartDate", sql.DateTime2, startDate)
    .input("EndDate", sql.DateTime2, endDate)
    .input("Distributor", sql.VarChar, distributor)
    .query<VisitSummaryRecord>(`
      SELECT
        LocationCode AS DISTRIBUTOR,
        RouteCode AS ROUTE,
        TransactionDate AS TRANSACTION_DATE,
        VisitSequence AS VISIT_SEQUENCE,
        CustomerCode AS CUSTOMER_CODE,
        VisitStartDateTime AS VISIT_START,
        VisitEndDateTime AS VISIT_END,
        StartGeoCodeX AS GEO_X,
        StartGeoCodeY AS GEO_Y
      FROM IG_O_VisitSummary
      WHERE LocationCode = @Distributor
        AND TransactionDate >= @StartDate AND TransactionDate <= @EndDate
    `);

  return result.recordset.map((r) => {
    // "Null island" sentinel -- see the module comment above.
    const isNullIsland = r.GEO_X === 0 && r.GEO_Y === 0;
    return {
      distributor: r.DISTRIBUTOR,
      route: r.ROUTE,
      transactionDate: r.TRANSACTION_DATE.toISOString().slice(0, 10),
      visitSequence: r.VISIT_SEQUENCE,
      customerCode: r.CUSTOMER_CODE.replace(/~/g, ""),
      visitStartAt: r.VISIT_START.toISOString(),
      visitEndAt: r.VISIT_END.toISOString(),
      startLatitude: isNullIsland ? null : r.GEO_Y,
      startLongitude: isNullIsland ? null : r.GEO_X,
    };
  });
}

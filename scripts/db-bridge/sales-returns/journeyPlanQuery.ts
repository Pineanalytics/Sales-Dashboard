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
//
// Outlet coordinates (added for the Active Outlet module): Centegy keeps
// GeoCodeX/GeoCodeY (longitude/latitude, GIS convention) on its customer
// tables. This feed was never able to see which table holds them for a given
// branch, so the column is DISCOVERED at run time from INFORMATION_SCHEMA —
// IG_I_JourneyPlan itself first, then IG_I_Customer joined on CustomerCode —
// and read only when found. Any failure falls back to the coordinate-less
// roster, so a schema difference can never break the existing sync.
import sql from "mssql";

export interface JourneyPlanAssignmentRow {
  distributor: string;
  pjp: string;
  routeDesc: string;
  customerCode: string;
  sequenceDay: number | null;
  workingDay: number | null;
  /** Outlet GPS from Centegy's GeoCodeY / Latitude column; null when none was found or the value was empty. */
  latitude: number | null;
  /** Outlet GPS from Centegy's GeoCodeX / Longitude column. */
  longitude: number | null;
}

interface JourneyPlanAssignmentRecord {
  DISTRIBUTOR: string;
  PJP: string;
  ROUTE_DESC: string;
  CUSTOMER_CODE: string;
  SEQUENCE_DAY: number | null;
  WORKING_DAY: number | null;
  LATITUDE?: number | null;
  LONGITUDE?: number | null;
}

export interface CoordinateSource {
  table: "IG_I_JourneyPlan" | "IG_I_Customer";
  xColumn: string; // longitude
  yColumn: string; // latitude
  /** IG_I_Customer only: the columns to join on (CustomerCode, plus LocationCode when it exists). */
  joinColumns: string[];
}

const IDENTIFIER = /^[A-Za-z0-9_]+$/;
const X_COLUMN = /^(geocodex|longitude|long|lng|lon)$/i;
const Y_COLUMN = /^(geocodey|latitude|lat)$/i;

/** Picks where the coordinates live from the columns INFORMATION_SCHEMA reports. Pure, so it is unit-tested. */
export function pickCoordinateSource(columns: { table: string; column: string }[]): CoordinateSource | null {
  const by = (table: string) => columns.filter((c) => c.table.toLowerCase() === table.toLowerCase() && IDENTIFIER.test(c.column)).map((c) => c.column);
  const pairIn = (names: string[]) => {
    const x = names.find((name) => X_COLUMN.test(name));
    const y = names.find((name) => Y_COLUMN.test(name));
    return x && y ? { x, y } : null;
  };

  const plan = pairIn(by("IG_I_JourneyPlan"));
  if (plan) return { table: "IG_I_JourneyPlan", xColumn: plan.x, yColumn: plan.y, joinColumns: [] };

  const customerColumns = by("IG_I_Customer");
  const customer = pairIn(customerColumns);
  const customerCode = customerColumns.find((name) => name.toLowerCase() === "customercode");
  if (customer && customerCode) {
    const location = customerColumns.find((name) => name.toLowerCase() === "locationcode");
    return { table: "IG_I_Customer", xColumn: customer.x, yColumn: customer.y, joinColumns: location ? [customerCode, location] : [customerCode] };
  }
  return null;
}

const COORDINATE_HINT = /geo|lat|lon|lng|coord|gps|map/i;

async function discoverCoordinateSource(pool: sql.ConnectionPool): Promise<{ source: CoordinateSource | null; candidates: string[] }> {
  const result = await pool.request().query<{ TABLE_NAME: string; COLUMN_NAME: string }>(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ('IG_I_JourneyPlan', 'IG_I_Customer')
  `);
  const columns = result.recordset.map((r) => ({ table: r.TABLE_NAME, column: r.COLUMN_NAME }));
  return {
    source: pickCoordinateSource(columns),
    // Shown in the sync log when nothing matched, so the real column names are visible without another probe run.
    candidates: columns.filter((c) => COORDINATE_HINT.test(c.column)).map((c) => `${c.table}.${c.column}`),
  };
}

/** The roster query with coordinates. A 0 or empty coordinate is "no GPS" (Centegy writes 0 for unset), so it never wins the MAX. */
function rosterSql(source: CoordinateSource | null): string {
  const base = (lat: string, lon: string, from: string) => `
      SELECT
        j.LocationCode AS DISTRIBUTOR,
        j.JourneyPlanCode AS PJP,
        MAX(j.JourneyPlanDescription) AS ROUTE_DESC,
        j.CustomerCode AS CUSTOMER_CODE,
        MIN(j.SequenceDay) AS SEQUENCE_DAY,
        MAX(j.WorkingDay) AS WORKING_DAY${lat}${lon}
      FROM ${from}
      WHERE j.LocationCode = @Distributor
      GROUP BY j.LocationCode, j.JourneyPlanCode, j.CustomerCode`;
  if (!source) return base("", "", "IG_I_JourneyPlan j");

  const lat = `,\n        MAX(CASE WHEN TRY_CAST(%T.${source.yColumn} AS float) <> 0 THEN TRY_CAST(%T.${source.yColumn} AS float) END) AS LATITUDE`;
  const lon = `,\n        MAX(CASE WHEN TRY_CAST(%T.${source.xColumn} AS float) <> 0 THEN TRY_CAST(%T.${source.xColumn} AS float) END) AS LONGITUDE`;
  if (source.table === "IG_I_JourneyPlan") return base(lat.replace(/%T/g, "j"), lon.replace(/%T/g, "j"), "IG_I_JourneyPlan j");

  const join = source.joinColumns.map((column) => (column.toLowerCase() === "locationcode" ? `c.${column} = j.LocationCode` : `c.${column} = j.CustomerCode`)).join(" AND ");
  return base(lat.replace(/%T/g, "c"), lon.replace(/%T/g, "c"), `IG_I_JourneyPlan j LEFT JOIN IG_I_Customer c ON ${join}`);
}

function toRow(r: JourneyPlanAssignmentRecord): JourneyPlanAssignmentRow {
  return {
    distributor: r.DISTRIBUTOR,
    pjp: r.PJP,
    routeDesc: r.ROUTE_DESC,
    customerCode: r.CUSTOMER_CODE.replace(/~/g, ""),
    sequenceDay: r.SEQUENCE_DAY,
    workingDay: r.WORKING_DAY,
    latitude: typeof r.LATITUDE === "number" && Number.isFinite(r.LATITUDE) ? r.LATITUDE : null,
    longitude: typeof r.LONGITUDE === "number" && Number.isFinite(r.LONGITUDE) ? r.LONGITUDE : null,
  };
}

/** Fetches the current outlet roster for every PJP on one distributor.
 * CustomerCode comes back "~"-separated (e.g. "T0045~002~001~00053787");
 * normalized here to plain concatenation to match
 * SalesReturnLine.customerCode / OutletSkuDailySales.outletCode. */
export async function fetchJourneyPlanAssignments(pool: sql.ConnectionPool, distributor: string): Promise<JourneyPlanAssignmentRow[]> {
  const run = (source: CoordinateSource | null) => pool.request().input("Distributor", sql.VarChar, distributor).query<JourneyPlanAssignmentRecord>(rosterSql(source));

  let source: CoordinateSource | null = null;
  let candidates: string[] = [];
  try {
    ({ source, candidates } = await discoverCoordinateSource(pool));
  } catch (error) {
    console.warn(`[sales-returns] Could not inspect the Centegy schema for outlet coordinates; syncing the roster without them. ${error instanceof Error ? error.message : error}`);
  }

  if (source) {
    try {
      const rows = (await run(source)).recordset.map(toRow);
      const withGps = rows.filter((row) => row.latitude !== null && row.longitude !== null).length;
      console.log(`[sales-returns] Outlet coordinates read from ${source.table}.${source.yColumn}/${source.xColumn}: ${withGps} of ${rows.length} roster rows have GPS.`);
      return rows;
    } catch (error) {
      console.warn(`[sales-returns] Reading coordinates from ${source.table} failed; syncing the roster without them. ${error instanceof Error ? error.message : error}`);
    }
  } else {
    console.log(
      `[sales-returns] No usable coordinate column pair on IG_I_JourneyPlan or IG_I_Customer; roster synced without GPS. Columns that look related: ${candidates.length > 0 ? candidates.join(", ") : "none"}.`
    );
  }
  return (await run(null)).recordset.map(toRow);
}

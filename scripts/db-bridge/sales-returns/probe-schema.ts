// One-off, read-only diagnostic for the Unilever KPI card build
// (lib/unileverKpi.ts) — NOT a scheduled automation, run manually on the
// isolated Nairobi/Nyeri machine (same network as scripts/sales-returns-sync.ps1)
// against the same Centegy SQL Server this bridge already reads.
//
// Answers two open questions from the KPI-card build that can't be checked
// from the dashboard's own environment (the Centegy machines have no inbound
// access — see docs/automation-registry.md's "Sales & Returns branch sync"
// entry):
//   1. Does POP (or any other table) hold the FULL outlet roster assigned to
//      a PJP, independent of whether it's transacted yet? Needed for ECO
//      (Coverage) and Perfect Assortment's denominators.
//   2. Where does Centegy store GPS/geofence data for a visit? Needed for
//      Geo-Match.
//
// Run with the same SALES_RETURNS_SQL_* / SALES_RETURNS_DISTRIBUTOR env vars
// as scripts/db-bridge/sales-returns/run.ts (see .env.example), e.g.:
//   npm run sales-returns:probe-schema
// Paste the console output back for lib/unileverKpi.ts to be extended.
process.loadEnvFile();

import sql from "mssql";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the Sales & Returns SQL Server read-only connection.`);
  return value;
}

async function main() {
  const distributor = required("SALES_RETURNS_DISTRIBUTOR");
  const instanceName = process.env.SALES_RETURNS_SQL_INSTANCE || undefined;
  const pool = await new sql.ConnectionPool({
    server: required("SALES_RETURNS_SQL_SERVER"),
    ...(instanceName ? {} : { port: Number(process.env.SALES_RETURNS_SQL_PORT ?? 1433) }),
    database: required("SALES_RETURNS_SQL_DATABASE"),
    user: required("SALES_RETURNS_SQL_USER"),
    password: required("SALES_RETURNS_SQL_PASSWORD"),
    connectionTimeout: 30_000,
    requestTimeout: 2 * 60_000,
    options: {
      encrypt: (process.env.SALES_RETURNS_SQL_ENCRYPT ?? "false") === "true",
      trustServerCertificate: (process.env.SALES_RETURNS_SQL_TRUST_SERVER_CERT ?? "true") === "true",
      ...(instanceName ? { instanceName } : {}),
    },
  }).connect();

  try {
    console.log(`\n=== POP table columns (distributor ${distributor}) ===`);
    const popColumns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'POP'
      ORDER BY ORDINAL_POSITION
    `);
    console.table(popColumns.recordset);

    console.log(`\n=== Any table/column name suggesting GPS/geofence data ===`);
    const geoColumns = await pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE COLUMN_NAME LIKE '%LAT%' OR COLUMN_NAME LIKE '%LONG%' OR COLUMN_NAME LIKE '%GPS%' OR COLUMN_NAME LIKE '%GEO%'
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);
    console.table(geoColumns.recordset);

    console.log(`\n=== Any table name suggesting a visit/journey-plan/tracking log (possible attempted-visit or assigned-outlet source) ===`);
    const visitTables = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%VISIT%' OR TABLE_NAME LIKE '%JOURNEY%' OR TABLE_NAME LIKE '%JP%' OR TABLE_NAME LIKE '%PJP%' OR TABLE_NAME LIKE '%CHECKIN%' OR TABLE_NAME LIKE '%TRACK%'
      ORDER BY TABLE_NAME
    `);
    console.table(visitTables.recordset);

    console.log(`\n=== Sample POP rows for one PJP (top 5, whichever PJP has the most CASHMEMO rows this month) ===`);
    const samplePjp = await pool.request().input("Distributor", sql.VarChar, distributor).query(`
      SELECT TOP 1 PJP FROM CASHMEMO WHERE DISTRIBUTOR = @Distributor AND DELV_DATE >= DATEADD(day, -30, GETDATE())
      GROUP BY PJP ORDER BY COUNT(*) DESC
    `);
    const pjp = samplePjp.recordset[0]?.PJP;
    console.log(`Using PJP = ${pjp ?? "(none found in the last 30 days)"}`);
    if (pjp) {
      // Every column, not just the ones the existing sales-returns query
      // selects — this is the whole point of the probe.
      const popSample = await pool.request().input("Distributor", sql.VarChar, distributor).query(`
        SELECT TOP 5 P.*
        FROM POP P
        WHERE P.DISTRIBUTOR = @Distributor
      `);
      console.table(popSample.recordset);
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error("[sales-returns:probe-schema]", err);
  process.exit(1);
});

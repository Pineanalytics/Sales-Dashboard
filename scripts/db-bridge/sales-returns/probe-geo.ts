// One-off, read-only diagnostic: where does Centegy keep outlet GPS, how many
// outlets actually have it, and how is the Geo-Match KPI (EDGCR01/EDGCR02)
// defined? The dashboard only receives Centegy's pre-computed Geo-Match COUNTS
// (MisKpiValue, per PJP) - never the coordinates behind them - so the Active
// Outlet module cannot place Leverage outlets on a map. This probe answers where
// the coordinates are so the journey-plan sync can carry them.
//
// NOT a scheduled automation. Run by hand on the isolated Nairobi / Nyeri
// machine (same env vars as run.ts and probe-schema.ts), then paste the console
// output back:
//   npm run sales-returns:probe-geo
// Strictly read-only (SELECT / INFORMATION_SCHEMA only); every section is
// isolated so a missing table or column only skips that section.
process.loadEnvFile();

import sql from "mssql";

const IDENTIFIER = /^[A-Za-z0-9_]+$/;
const X_COLUMN = /^(geocodex|longitude|long|lng|lon|startgeocodex)$/i;
const Y_COLUMN = /^(geocodey|latitude|lat|startgeocodey)$/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the Sales & Returns SQL Server read-only connection.`);
  return value;
}

async function section(title: string, body: () => Promise<void>) {
  console.log(`\n=== ${title} ===`);
  try {
    await body();
  } catch (error) {
    console.log(`(skipped: ${error instanceof Error ? error.message : error})`);
  }
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
    console.log(`Distributor ${distributor} - Centegy outlet GPS probe`);

    // 1. Every table carrying a coordinate-looking column, with its key columns.
    let geoTables: { TABLE_NAME: string; COLUMN_NAME: string }[] = [];
    await section("Tables with coordinate-like columns (and whether they carry a customer code)", async () => {
      const result = await pool.request().query<{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string }>(`
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%GEOCODE%' OR COLUMN_NAME LIKE '%LATITUDE%' OR COLUMN_NAME LIKE '%LONGITUDE%'
           OR COLUMN_NAME LIKE '%GPS%' OR COLUMN_NAME IN ('LAT', 'LNG', 'LON', 'LONG')
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `);
      geoTables = result.recordset;
      console.table(result.recordset);
      const withCustomer = await pool.request().query(`
        SELECT DISTINCT g.TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS g
        INNER JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_NAME = g.TABLE_NAME AND c.COLUMN_NAME LIKE '%CUSTOMER%'
        WHERE g.COLUMN_NAME LIKE '%GEOCODE%' OR g.COLUMN_NAME LIKE '%LATITUDE%' OR g.COLUMN_NAME LIKE '%LONGITUDE%'
        ORDER BY g.TABLE_NAME
      `);
      console.log("Of these, tables that also have a CUSTOMER column:");
      console.table(withCustomer.recordset);
    });

    // 2. For each such table with an X/Y pair: how many rows really have a position?
    const byTable = new Map<string, string[]>();
    for (const row of geoTables) byTable.set(row.TABLE_NAME, [...(byTable.get(row.TABLE_NAME) ?? []), row.COLUMN_NAME]);
    for (const [table, columns] of byTable) {
      const x = columns.find((name) => X_COLUMN.test(name));
      const y = columns.find((name) => Y_COLUMN.test(name));
      if (!x || !y || !IDENTIFIER.test(table) || !IDENTIFIER.test(x) || !IDENTIFIER.test(y)) continue;
      await section(`Coverage in ${table}.${x} / ${y}`, async () => {
        const stats = await pool.request().query(`
          SELECT COUNT(*) AS ROWS_TOTAL,
                 SUM(CASE WHEN TRY_CAST(${x} AS float) <> 0 AND TRY_CAST(${y} AS float) <> 0 THEN 1 ELSE 0 END) AS ROWS_WITH_POSITION,
                 MIN(TRY_CAST(${y} AS float)) AS MIN_Y, MAX(TRY_CAST(${y} AS float)) AS MAX_Y,
                 MIN(TRY_CAST(${x} AS float)) AS MIN_X, MAX(TRY_CAST(${x} AS float)) AS MAX_X
          FROM ${table}
        `);
        console.table(stats.recordset);
        const sample = await pool.request().query(`SELECT TOP 3 * FROM ${table} WHERE TRY_CAST(${x} AS float) <> 0 AND TRY_CAST(${y} AS float) <> 0`);
        console.log("Sample rows that carry a position:");
        console.table(sample.recordset);
      });
    }

    // 3. The journey plan and customer master: their full column lists.
    for (const table of ["IG_I_JourneyPlan", "IG_I_Customer", "Bck_IG_O_CustomerGeoCode"]) {
      await section(`Columns of ${table}`, async () => {
        const columns = await pool.request().input("Table", sql.VarChar, table).query(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @Table ORDER BY ORDINAL_POSITION
        `);
        if (columns.recordset.length === 0) console.log("(table not found)");
        else console.table(columns.recordset);
      });
    }

    // 4. How Centegy defines the Geo-Match KPI the dashboard reports (EDGCR01 scheduled / EDGCR02 matched).
    await section("MIS_KPI definition rows for EDGCR01 / EDGCR02", async () => {
      const definition = await pool.request().query(`SELECT * FROM MIS_KPI WHERE KPI_ID IN ('EDGCR01', 'EDGCR02')`);
      console.log(JSON.stringify(definition.recordset, null, 2).slice(0, 6000));
    });
    await section("Tables whose name suggests a geofence / geocode check (the source behind EDGCR01/02)", async () => {
      const tables = await pool.request().query(`
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE '%GEOFENCE%' OR TABLE_NAME LIKE '%GEOCODE%' OR TABLE_NAME LIKE '%EFOS%' OR TABLE_NAME LIKE '%GEOMATCH%'
        ORDER BY TABLE_NAME
      `);
      console.table(tables.recordset);
    });
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error("[sales-returns:probe-geo]", err);
  process.exit(1);
});

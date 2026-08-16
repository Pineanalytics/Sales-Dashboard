// EABL Call Performance bridge. This is deliberately separate from the Pine
// MySQL timestamp worker: it reads the supplied Power Query's SQL Server
// source and preserves its call-level sales/time semantics.
process.loadEnvFile();

import sql from "mssql";

const APP_URL = process.env.EABL_CALL_APP_URL ?? "https://pinefrostdb.com";
const BRIDGE = "eabl-call-performance";
const BATCH_SIZE = 1000;

interface SourceCall {
  sourceCallKey: string; callDate: Date; salesman: string; agent: string | null; customerCode: string | null; customerName: string;
  customerType: string | null; segment: string | null; timeIn: Date | null; timeOut: Date | null; durationMinutes: number | null;
  firstCallOfDay: Date | null; lastCallOfDay: Date | null; callsInDay: number; productiveCallsInDay: number; dayStrikeRatePct: number | null;
  cashSales: number; creditSales: number; discounts: number; netSales: number; isProductive: boolean;
}

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}. Configure the EABL SQL Server read-only connection.`); return value; }
function dateWindow(now: Date) {
  const from = process.env.EABL_CALL_BACKFILL_FROM;
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  if (Number.isNaN(start.getTime())) throw new Error("EABL_CALL_BACKFILL_FROM must be YYYY-MM-DD.");
  return { start, end: now };
}
async function post(path: string, body: unknown) {
  const response = await fetch(`${APP_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-upload-api-key": required("UPLOAD_API_KEY") }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
}

async function main() {
  const now = new Date();
  const { start, end } = dateWindow(now);
  const pool = await new sql.ConnectionPool({ server: required("EABL_CALL_SQL_SERVER"), port: Number(process.env.EABL_CALL_SQL_PORT ?? 1433), database: required("EABL_CALL_SQL_DATABASE"), user: required("EABL_CALL_SQL_USER"), password: required("EABL_CALL_SQL_PASSWORD"), connectionTimeout: 30_000, requestTimeout: 10 * 60_000, options: { encrypt: (process.env.EABL_CALL_SQL_ENCRYPT ?? "false") === "true", trustServerCertificate: (process.env.EABL_CALL_SQL_TRUST_SERVER_CERT ?? "true") === "true" } }).connect();
  try {
    const result = await pool.request().input("start", sql.DateTime2, start).input("end", sql.DateTime2, end).query<SourceCall>(`
      SELECT CONCAT('eabl:', CONVERT(varchar(100), c.Id)) AS sourceCallKey,
        c.CallDate AS callDate, d.Salesman AS salesman, d.Agent AS agent, c.CustomerCode AS customerCode, c.CustomerName AS customerName, c.CustType AS customerType, c.Segment AS segment,
        c.TimeIn AS timeIn, c.TimeOut AS timeOut, DATEDIFF(minute, c.TimeIn, c.TimeOut) AS durationMinutes,
        MIN(c.TimeIn) OVER (PARTITION BY c.SalesmanDayId) AS firstCallOfDay, MAX(c.TimeOut) OVER (PARTITION BY c.SalesmanDayId) AS lastCallOfDay,
        COUNT(*) OVER (PARTITION BY c.SalesmanDayId) AS callsInDay, SUM(CASE WHEN c.NetSales > 0 THEN 1 ELSE 0 END) OVER (PARTITION BY c.SalesmanDayId) AS productiveCallsInDay,
        CAST(100.0 * SUM(CASE WHEN c.NetSales > 0 THEN 1 ELSE 0 END) OVER (PARTITION BY c.SalesmanDayId) / NULLIF(COUNT(*) OVER (PARTITION BY c.SalesmanDayId), 0) AS decimal(10,1)) AS dayStrikeRatePct,
        COALESCE(c.CashSales, 0) AS cashSales, COALESCE(c.CreditSales, 0) AS creditSales, COALESCE(c.Discounts, 0) AS discounts, COALESCE(c.NetSales, 0) AS netSales, CAST(CASE WHEN c.NetSales > 0 THEN 1 ELSE 0 END AS bit) AS isProductive
      FROM PinefrostAnalytics.Transactions.DSR_Calls c INNER JOIN PinefrostAnalytics.Transactions.DSR_SalesmanDay d ON d.Id = c.SalesmanDayId
      WHERE c.CallDate >= @start AND c.CallDate < @end ORDER BY c.CallDate, d.Salesman, c.TimeIn`);
    const rows = result.recordset.map((row) => ({ ...row, callDate: row.callDate.toISOString(), timeIn: row.timeIn?.toISOString() ?? null, timeOut: row.timeOut?.toISOString() ?? null, firstCallOfDay: row.firstCallOfDay?.toISOString() ?? null, lastCallOfDay: row.lastCallOfDay?.toISOString() ?? null, isProductive: Boolean(row.isProductive) }));
    for (let index = 0; index < rows.length; index += BATCH_SIZE) await post("/api/eabl-call-performance/upload", { calls: rows.slice(index, index + BATCH_SIZE), windowStart: index === 0 ? start.toISOString() : undefined, retainFrom: index === 0 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString() : undefined });
    await post("/api/active-outlets/sync-state", { bridge: BRIDGE, lastIncrementalAt: now.toISOString() });
    console.log(`[eabl-call-performance] Uploaded ${rows.length} call rows for ${start.toISOString()} to ${end.toISOString()}.`);
  } finally { await pool.close(); }
}

main().catch((error) => { console.error("[eabl-call-performance] FAILED:", error); process.exitCode = 1; });

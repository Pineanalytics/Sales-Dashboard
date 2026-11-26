// Looking invoice references up in the systems outside the dashboard: Pine (orders and sales) and EABL DMS. Read-only SELECTs.
import type { RowDataPacket } from "mysql2/promise";
import sql from "mssql";
import { normalizeReference } from "../../../lib/invoiceReferences";
import { loadCoverageConfigFromEnv, withCoverageConnection } from "../coverage/mysql";

/** The key looked up in one system -> the stored references that gave it. */
export type Wanted = Map<string, string[]>;

/** Pine has no index on the invoice number, so the window is read by date and matched here. */
export async function fromPine(table: "orders" | "sales", wanted: Wanted, start: Date, end: Date): Promise<Map<string, string>> {
  const prefix = table === "orders" ? "ode" : "s";
  const rows = await withCoverageConnection(loadCoverageConfigFromEnv(), async (conn) => {
    const [result] = await conn.query<(RowDataPacket & { ref: string; cid: number })[]>(
      `SELECT ${prefix}_invoiceno AS ref, ${prefix}_cid AS cid FROM pine.${table} WHERE ${prefix}_date >= ? AND ${prefix}_date < ? AND ${prefix}_invoiceno <> ''`,
      [start, end]
    );
    return result;
  });
  const found = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeReference(row.ref);
    if (wanted.has(key) && row.cid) found.set(key, String(row.cid));
  }
  return found;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the EABL SQL Server read-only connection.`);
  return value;
}

export async function fromEabl(wanted: Wanted, start: Date, end: Date): Promise<Map<string, string>> {
  const pool = await new sql.ConnectionPool({
    server: required("EABL_CALL_SQL_SERVER"),
    port: Number(process.env.EABL_CALL_SQL_PORT ?? 1433),
    database: required("EABL_CALL_SQL_DATABASE"),
    user: required("EABL_CALL_SQL_USER"),
    password: required("EABL_CALL_SQL_PASSWORD"),
    connectionTimeout: 30_000,
    requestTimeout: 5 * 60_000,
    options: {
      encrypt: (process.env.EABL_CALL_SQL_ENCRYPT ?? "false") === "true",
      trustServerCertificate: (process.env.EABL_CALL_SQL_TRUST_SERVER_CERT ?? "true") === "true",
    },
  }).connect();
  try {
    const result = await pool.request().input("Start", sql.Date, start).input("End", sql.Date, end).query<{ TransactionNumber: string | null; CashBillReference: string | null; CustomerCode: string | null }>(
      `SELECT DISTINCT TransactionNumber, CashBillReference, CustomerCode FROM PinefrostAnalytics.Transactions.Sales WHERE TransactionDate >= @Start AND TransactionDate < @End`
    );
    const found = new Map<string, string>();
    for (const row of result.recordset) {
      const code = row.CustomerCode?.trim();
      if (!code) continue;
      for (const number of [row.TransactionNumber, row.CashBillReference]) {
        const key = normalizeReference(number);
        if (wanted.has(key)) found.set(key, code);
      }
    }
    return found;
  } finally {
    await pool.close();
  }
}

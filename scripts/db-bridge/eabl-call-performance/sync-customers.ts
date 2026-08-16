// EABL customer master sync. Deliberately separate from run.ts (the live
// call feed, 60s cadence) — this is reference/master data that barely
// changes day to day, so it runs on its own, much longer interval (see
// continuous-sync-worker.ts's "eabl-customers" job). A full reconcile every
// run, not a windowed delta - the source table is small (~800-1000 rows).
process.loadEnvFile();

import sql from "mssql";
import { fetchEablCustomers, transformEablCustomers } from "./customers";

const APP_URL = process.env.EABL_CALL_APP_URL ?? "https://pinefrostdb.com";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Configure the EABL SQL Server read-only connection.`);
  return value;
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": required("UPLOAD_API_KEY") },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
}

async function main() {
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
    const sourceRows = await fetchEablCustomers(pool);
    const customers = transformEablCustomers(sourceRows);
    // One request, not chunked at this level: the upload route does a full
    // reconcile (deletes anything missing from the payload) in a single
    // transaction — splitting into multiple requests would have each one
    // delete what the other just inserted. The route already chunks its own
    // INSERT statements internally; ~800-1000 rows is a trivial payload size
    // for a single self-hosted request (no serverless payload-limit concern
    // here — that constraint was Netlify-specific and no longer applies).
    await post("/api/eabl-call-performance/customers/upload", { customers });
    console.log(`[eabl-customers] Uploaded ${customers.length} customer master rows.`);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error("[eabl-customers] FAILED:", error);
  process.exitCode = 1;
});

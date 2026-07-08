// Connection helper for the read-only SQL bridge (scripts/db-bridge). Every query
// function in this tree only ever issues SELECT — there is no insert/update/exec
// helper anywhere in this module, so there is no code path capable of writing even
// if misused, on top of the SQL login itself being provisioned read-only.
import sql from "mssql";

export interface BridgeConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var "${name}". Set it in .env — see .env.example for the full SQLBRIDGE_* list.`
    );
  }
  return value;
}

export function loadConfigFromEnv(): BridgeConfig {
  return {
    server: readEnv("SQLBRIDGE_SQL_SERVER"),
    database: readEnv("SQLBRIDGE_SQL_DATABASE"),
    user: readEnv("SQLBRIDGE_SQL_USER"),
    password: readEnv("SQLBRIDGE_SQL_PASSWORD"),
    encrypt: (process.env.SQLBRIDGE_SQL_ENCRYPT ?? "false").toLowerCase() === "true",
    trustServerCertificate: (process.env.SQLBRIDGE_SQL_TRUST_SERVER_CERT ?? "true").toLowerCase() === "true",
  };
}

export async function withConnection<T>(
  config: BridgeConfig,
  fn: (pool: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  const pool = await new sql.ConnectionPool({
    server: config.server,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  }).connect();

  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

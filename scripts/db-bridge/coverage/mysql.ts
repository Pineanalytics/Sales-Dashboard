// Connection helper for the Coverage MySQL bridge — a genuinely different system
// from SQLBRIDGE_SQL_* (SAP on SQL Server): a MySQL database backing a separate
// field-force/SFA mobile app (schema "pine"). Read-only by construction, same as
// ../sql.ts: every query function in this tree only ever issues SELECT.
import mysql from "mysql2/promise";

export interface CoverageMysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var "${name}". Set it in .env — see .env.example for the full SQLBRIDGE_COVERAGE_MYSQL_* list.`
    );
  }
  return value;
}

export function loadCoverageConfigFromEnv(): CoverageMysqlConfig {
  return {
    host: readEnv("SQLBRIDGE_COVERAGE_MYSQL_HOST"),
    port: Number(process.env.SQLBRIDGE_COVERAGE_MYSQL_PORT ?? "3306"),
    user: readEnv("SQLBRIDGE_COVERAGE_MYSQL_USER"),
    password: readEnv("SQLBRIDGE_COVERAGE_MYSQL_PASSWORD"),
    database: readEnv("SQLBRIDGE_COVERAGE_MYSQL_DATABASE"),
  };
}

export async function withCoverageConnection<T>(
  config: CoverageMysqlConfig,
  fn: (conn: mysql.Connection) => Promise<T>
): Promise<T> {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
  });

  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

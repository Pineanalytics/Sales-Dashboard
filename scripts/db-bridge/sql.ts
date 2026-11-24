// Connection helper for the read-only SQL bridge (scripts/db-bridge). Every query
// function in this tree only ever issues SELECT — there is no insert/update/exec
// helper anywhere in this module, so there is no code path capable of writing even
// if misused, on top of the SQL login itself being provisioned read-only.
import path from "node:path";
import sql from "mssql";

export interface BridgeConfig {
  server: string;
  port: number;
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
    port: Number(process.env.SQLBRIDGE_SQL_PORT ?? "1433"),
    database: readEnv("SQLBRIDGE_SQL_DATABASE"),
    user: readEnv("SQLBRIDGE_SQL_USER"),
    password: readEnv("SQLBRIDGE_SQL_PASSWORD"),
    encrypt: (process.env.SQLBRIDGE_SQL_ENCRYPT ?? "false").toLowerCase() === "true",
    trustServerCertificate: (process.env.SQLBRIDGE_SQL_TRUST_SERVER_CERT ?? "true").toLowerCase() === "true",
  };
}

/** tedious' ISOLATION_LEVEL.READ_UNCOMMITTED. tedious is mssql's driver; the constant is spelled out so this file does not import a transitive dependency. */
const READ_UNCOMMITTED = 0x01;

/**
 * The name this process shows in SQL Server (sys.dm_exec_sessions.program_name), e.g. "pinefrost-sync:stock-sync" or
 * "pinefrost-sync:receivables/run". It used to be mssql's default, "node-mssql", which told a DBA nothing about which job
 * was holding a session on the SAP server.
 */
export function sapAppName(entry: string | undefined = process.argv[1]): string {
  if (!entry) return "pinefrost-sync";
  const parsed = path.parse(entry);
  const parent = path.basename(parsed.dir);
  const label = parsed.name === "run" || parsed.name === "sync" ? `${parent}/${parsed.name}` : parsed.name;
  return `pinefrost-sync:${label}`.slice(0, 120);
}

/**
 * Connection settings for the SAP server. Every query in this tree is a read-only report over SAP's own tables, and SAP
 * users are posting invoices and receipts on the same server, so these sessions read with READ UNCOMMITTED: a report
 * never takes shared locks that make a user's document wait, and is never made to wait for a user's open transaction. The
 * trade-off is that a document SAP is half way through posting can be read before it commits; the sync re-reads the
 * current period every 30 minutes, so a rolled-back document does not last.
 */
export function sapPoolConfig(config: BridgeConfig, appName: string = sapAppName()): sql.config {
  return {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    // mssql's default requestTimeout (15s) is too short for YTD_Raw/Stock_Balance's
    // full-year multi-branch UNION queries against production SAP data. Bumped from
    // 5 to 10 minutes once YTD_Raw started covering 2 full calendar years (YTD +
    // LYTD, used together for the historical backfill — see sales-sync.ts's
    // --backfill flag) at the heavier Item x Warehouse x Customer x Rep grain.
    requestTimeout: 10 * 60 * 1000,
    connectionTimeout: 30 * 1000,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
      appName,
      connectionIsolationLevel: READ_UNCOMMITTED,
    } as sql.config["options"],
  };
}

export async function withConnection<T>(
  config: BridgeConfig,
  fn: (pool: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  const pool = await new sql.ConnectionPool(sapPoolConfig(config)).connect();

  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

// Production counterpart to coverage/run.ts. It reads Pine directly, preserves
// the former workbook's cost-centre attribution in buildCoverage(), then replaces
// exactly one calendar month at a time on the dashboard.
process.loadEnvFile();

import { loadCoverageConfigFromEnv, withCoverageConnection } from "./mysql";
import { fetchPrincipalCostCentreFact } from "./query";
import { buildCoverage } from "./transform";
import { loadPrincipals } from "../reference/loadFromDb";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

interface MonthRange {
  year: string;
  monthIndex: number;
  start: Date;
  end: Date;
}

function parseMonth(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM.`);
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error(`${label} must be a valid YYYY-MM.`);
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthRanges(now: Date): MonthRange[] {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = parseMonth(process.env.COVERAGE_SYNC_FROM, "COVERAGE_SYNC_FROM") ?? current;
  const to = parseMonth(process.env.COVERAGE_SYNC_TO, "COVERAGE_SYNC_TO") ?? from;
  if (to < from) throw new Error("COVERAGE_SYNC_TO cannot be before COVERAGE_SYNC_FROM.");

  const ranges: MonthRange[] = [];
  for (let cursor = new Date(from); cursor <= to; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    ranges.push({
      year: String(cursor.getUTCFullYear()),
      monthIndex: cursor.getUTCMonth(),
      start: cursor,
      end: new Date(next.getTime() - 86400000),
    });
  }
  return ranges;
}

async function main() {
  const config = loadCoverageConfigFromEnv();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const ranges = monthRanges(new Date());
  const principals = await loadPrincipals();

  for (const range of ranges) {
    console.log(`[coverage-sync] Reading ${range.year}-${String(range.monthIndex + 1).padStart(2, "0")} from ${config.host}/${config.database}...`);
    const rawRows = await withCoverageConnection(config, (conn) => fetchPrincipalCostCentreFact(conn, range.start, range.end));
    const { rows, unmatchedCostCentres } = buildCoverage(rawRows, principals);
    const monthRows = rows.filter((row) => row.year === range.year && row.monthIndex === range.monthIndex);
    const response = await fetch(`${appUrl}/api/coverage/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
      body: JSON.stringify({ year: range.year, monthIndex: range.monthIndex, rows: monthRows }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Coverage upload rejected for ${range.year}-${range.monthIndex + 1} (HTTP ${response.status}): ${JSON.stringify(body)}`);
    console.log(`[coverage-sync] Saved ${body.count} rows for ${range.year}-${String(range.monthIndex + 1).padStart(2, "0")}; source rows ${rawRows.length}; unmatched cost centres ${unmatchedCostCentres.length}.`);
  }
}

main().catch((error) => {
  console.error("[coverage-sync] FAILED:", error);
  process.exitCode = 1;
});

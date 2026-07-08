// Entry point for the Coverage MySQL bridge — read-only end to end, exactly like
// ../run.ts (the SAP bridge): queries are SELECT-only, the only write this script
// performs is a local JSON file under output/ (gitignored). Never touches
// Prisma/Postgres, never calls any app API, never modifies the live Coverage data
// shown in the dashboard today. Run with: npm run db-bridge:coverage-run
process.loadEnvFile();

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCoverageConfigFromEnv, withCoverageConnection } from "./mysql";
import { fetchPrincipalCostCentreFact } from "./query";
import { buildCoverage } from "./transform";
import { findDormantReps } from "./dormantReps";
import principalsData from "../reference/principals.json";

async function main() {
  const config = loadCoverageConfigFromEnv();

  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const endDate = now;

  console.log(`[coverage-bridge] Connecting to ${config.host}/${config.database} (${startDate.toISOString().slice(0, 10)} - ${endDate.toISOString().slice(0, 10)})...`);

  const rawRows = await withCoverageConnection(config, (conn) => fetchPrincipalCostCentreFact(conn, startDate, endDate));
  console.log(`[coverage-bridge] Fetched ${rawRows.length} fact rows.`);

  const { rows: monthlyCoverage, unmatchedCostCentres } = buildCoverage(rawRows, principalsData);
  console.log(`[coverage-bridge] Built ${monthlyCoverage.length} monthly-coverage rows.`);
  if (unmatchedCostCentres.length > 0) {
    console.warn(
      `[coverage-bridge] WARNING: ${unmatchedCostCentres.length} Cost Centre value(s) didn't match a known Active principal (excluded): ${unmatchedCostCentres.join(", ")}`
    );
  }

  const dormantReps = findDormantReps(rawRows, endDate);
  console.log(`[coverage-bridge] Found ${dormantReps.length} dormant rep(s) (no activity in 30+ days).`);
  if (dormantReps.length > 0) {
    console.table(
      dormantReps.map((r) => ({
        employee: r.employeeName,
        userGroup: r.userGroup,
        region: r.userRegion,
        lastActivity: r.lastActivityDate,
        daysSince: r.daysSinceActivity,
      }))
    );
  }

  const outputDir = join(import.meta.dirname, "output");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDir, `coverage-output-${timestamp}.json`);
  writeFileSync(
    outputPath,
    JSON.stringify({ generatedAt: now.toISOString(), monthlyCoverage, unmatchedCostCentres, dormantReps }, null, 2)
  );

  console.log(`[coverage-bridge] Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error("[coverage-bridge] FAILED:", err);
  process.exitCode = 1;
});

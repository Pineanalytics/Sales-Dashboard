// Shadow-validation report: compares the Coverage MySQL bridge's freshly-computed
// output against the live dashboard's current dataset (Excel-sourced Calls &
// Productivity sheet today), using the SAME period-summarization code the app
// itself uses (lib/timeIntelligence.ts) so there's no risk of the comparison
// drifting from what users actually see. Read-only: reads the live dataset via
// Prisma (lib/datasetStore.ts's getLatestSnapshot()), reads the latest local
// coverage-output-*.json (written by run.ts), never writes anything anywhere.
// Run with: npm run db-bridge:coverage-compare
process.loadEnvFile();

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLatestSnapshot } from "@/lib/datasetStore";
import {
  CANONICAL_MONTHS,
  getCurrentMonthPeriod,
  summarizeCoverageForPeriod,
  summarizeCoverageByRep,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset, MonthlyCoverageRow } from "@/lib/types";

const TOLERANCE_PCT = 5; // coverage/productivity is inherently noisier than revenue — wider tolerance

interface BridgeOutput {
  generatedAt: string;
  monthlyCoverage: MonthlyCoverageRow[];
  unmatchedCostCentres: string[];
}

function loadLatestBridgeOutput(): BridgeOutput {
  const outputDir = join(import.meta.dirname, "output");
  const files = readdirSync(outputDir).filter((f) => f.startsWith("coverage-output-") && f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No coverage-output-*.json found in ${outputDir}. Run "npm run db-bridge:coverage-run" first.`);
  }
  files.sort().reverse();
  const latest = join(outputDir, files[0]);
  console.log(`[coverage-compare] Using bridge output: ${latest}`);
  return JSON.parse(readFileSync(latest, "utf8"));
}

/** Wraps the bridge's monthlyCoverage as a Dataset so it can be passed through
 *  lib/timeIntelligence.ts's summarization functions unchanged. Sales/stock/PL/
 *  brand-customer/weekly are all empty — out of scope for this bridge. */
function wrapBridgeAsDataset(bridge: BridgeOutput): Dataset {
  return {
    monthlySales: [],
    monthlyCoverage: bridge.monthlyCoverage,
    monthlyBrandCustomer: [],
    monthlyPL: [],
    weeklyProjection: [],
    stockTotal: {
      volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0,
      itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "",
    },
    stockItems: [],
    reportMeta: { title: "Coverage Bridge (shadow)", sheet: "" },
    uploadedAt: bridge.generatedAt,
  };
}

function lastFullMonthPeriod(current: PeriodSelection): PeriodSelection {
  const idx = CANONICAL_MONTHS.indexOf(current.month!);
  if (idx === 0) return { kind: "MONTH", year: String(Number(current.year) - 1), month: "December" };
  return { kind: "MONTH", year: current.year, month: CANONICAL_MONTHS[idx - 1] };
}

function flagPct(deltaPct: number | null): string {
  if (deltaPct === null) return "";
  return Math.abs(deltaPct) > TOLERANCE_PCT ? "⚠" : "";
}

function pct(live: number, bridge: number): number | null {
  if (live === 0) return bridge === 0 ? 0 : null;
  return Math.round(((bridge - live) / live) * 1000) / 10;
}

function printCoverageByPrincipal(label: string, period: PeriodSelection, liveDataset: Dataset, bridgeDataset: Dataset) {
  const principalKeys = Array.from(
    new Set([...liveDataset.monthlyCoverage, ...bridgeDataset.monthlyCoverage].map((r) => r.principalKey))
  ).sort();

  console.log(`\n=== Coverage vs Bridge, by principal: ${label} (${period.kind} ${period.year}${period.month ? " " + period.month : ""}) ===`);
  const rows = principalKeys.map((key) => {
    const l = summarizeCoverageForPeriod(liveDataset, period, key);
    const b = summarizeCoverageForPeriod(bridgeDataset, period, key);
    const coveragePct = pct(l.coverage, b.coverage);
    const productivePct = pct(l.productiveCalls, b.productiveCalls);
    return {
      principalKey: key,
      "live coverage": l.coverage,
      "bridge coverage": b.coverage,
      "coverage Δ%": coveragePct,
      "live productive": l.productiveCalls,
      "bridge productive": b.productiveCalls,
      "productive Δ%": productivePct,
      "live prod.%": l.productivityPct,
      "bridge prod.%": b.productivityPct,
      flag: [flagPct(coveragePct), flagPct(productivePct)].filter(Boolean).join(" "),
    };
  });
  console.table(rows);
}

function printCoverageByRep(label: string, period: PeriodSelection, liveDataset: Dataset, bridgeDataset: Dataset) {
  const liveReps = summarizeCoverageByRep(liveDataset, period, null);
  const bridgeReps = summarizeCoverageByRep(bridgeDataset, period, null);
  const names = Array.from(new Set([...liveReps.map((r) => r.employeeName), ...bridgeReps.map((r) => r.employeeName)])).sort();

  console.log(`\n=== Coverage vs Bridge, by rep: ${label} (${period.kind} ${period.year}${period.month ? " " + period.month : ""}) ===`);
  const rows = names.map((name) => {
    const l = liveReps.find((r) => r.employeeName === name);
    const b = bridgeReps.find((r) => r.employeeName === name);
    const coveragePct = pct(l?.coverage ?? 0, b?.coverage ?? 0);
    return {
      employeeName: name,
      "live coverage": l?.coverage ?? "(missing)",
      "bridge coverage": b?.coverage ?? "(missing)",
      "coverage Δ%": coveragePct,
      flag: flagPct(coveragePct),
    };
  });
  console.table(rows);
}

async function main() {
  const liveDataset = await getLatestSnapshot();
  if (!liveDataset) {
    throw new Error("No live snapshot found — upload a workbook via the app first.");
  }

  const bridgeOutput = loadLatestBridgeOutput();
  const bridgeDataset = wrapBridgeAsDataset(bridgeOutput);

  const mtd = getCurrentMonthPeriod(liveDataset);
  if (!mtd.month) {
    throw new Error("Live dataset has no resolvable current month — cannot compute comparison periods.");
  }
  const lastMonth = lastFullMonthPeriod(mtd);
  const ytd: PeriodSelection = { kind: "YTD", year: mtd.year, month: mtd.month };

  printCoverageByPrincipal("MTD", mtd, liveDataset, bridgeDataset);
  printCoverageByPrincipal("Last full month", lastMonth, liveDataset, bridgeDataset);
  printCoverageByPrincipal("YTD", ytd, liveDataset, bridgeDataset);
  printCoverageByRep("MTD", mtd, liveDataset, bridgeDataset);

  if (bridgeOutput.unmatchedCostCentres.length > 0) {
    console.log(`\n[coverage-compare] Bridge had ${bridgeOutput.unmatchedCostCentres.length} unmatched Cost Centre value(s), excluded from its output: ${bridgeOutput.unmatchedCostCentres.join(", ")}`);
  }
  console.log(
    `\n[coverage-compare] Tolerance: ${TOLERANCE_PCT}% — rows marked ⚠ exceed it. This is a shadow comparison only — the live Coverage view is untouched regardless of the result.`
  );
}

main().catch((err) => {
  console.error("[coverage-compare] FAILED:", err);
  process.exitCode = 1;
});

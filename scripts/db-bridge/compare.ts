// Shadow-validation report: compares the SQL bridge's freshly-computed output
// against the live dashboard's current dataset, using the SAME period-summarization
// code the app itself uses (lib/timeIntelligence.ts) so there's no risk of the
// comparison drifting from what users actually see. Read-only: reads the live
// dataset via Prisma (lib/datasetStore.ts's getLatestSnapshot(), no new endpoint),
// reads the latest local bridge-output-*.json (written by run.ts), never writes
// anything anywhere. Run with: npm run db-bridge:compare
process.loadEnvFile();

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLatestSnapshot } from "@/lib/datasetStore";
import {
  CANONICAL_MONTHS,
  getCurrentMonthPeriod,
  summarizeSalesByPrincipal,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset, MonthlySalesRow } from "@/lib/types";
import type { PartialStockItem } from "./transform/buildStock";

const TOLERANCE_PCT = 1;

interface BridgeOutput {
  generatedAt: string;
  monthlySales: Omit<MonthlySalesRow, "target">[];
  stockItems: PartialStockItem[];
}

function loadLatestBridgeOutput(): BridgeOutput {
  const outputDir = join(import.meta.dirname, "output");
  const files = readdirSync(outputDir).filter((f) => f.startsWith("bridge-output-") && f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No bridge-output-*.json found in ${outputDir}. Run "npm run db-bridge:run" first.`);
  }
  files.sort().reverse();
  const latest = join(outputDir, files[0]);
  console.log(`[compare] Using bridge output: ${latest}`);
  return JSON.parse(readFileSync(latest, "utf8"));
}

/** Wraps the bridge's partial output as a Dataset so it can be passed through
 *  lib/timeIntelligence.ts's summarization functions unchanged. Coverage/brand-customer/
 *  weekly/target are all empty/null — out of scope for this bridge, never fabricated. */
function wrapBridgeAsDataset(bridge: BridgeOutput): Dataset {
  return {
    monthlySales: bridge.monthlySales.map((r) => ({ ...r, target: null })),
    monthlyCoverage: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    weeklyProjection: [],
    stockTotal: {
      volume: 0, pcs: 0, value: 0, rrWeekValue: 0, rrWeekVolume: 0, daysStock: 0,
      itemCount: 0, outOfStockCount: 0, runningOutCount: 0, okCount: 0, noDataCount: 0, action: "",
    },
    stockItems: [],
    reportMeta: { title: "SQL Bridge (shadow)", sheet: "" },
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

function printSalesDiff(label: string, period: PeriodSelection, liveDataset: Dataset, bridgeDataset: Dataset) {
  const live = summarizeSalesByPrincipal(liveDataset, period);
  const bridge = summarizeSalesByPrincipal(bridgeDataset, period);
  const principals = Array.from(new Set([...live.keys(), ...bridge.keys()])).sort();

  console.log(`\n=== Sales vs Bridge: ${label} (${period.kind} ${period.year}${period.month ? " " + period.month : ""}) ===`);
  const rows = principals.map((p) => {
    const l = live.get(p);
    const b = bridge.get(p);
    const revenuePct = pct(l?.revenue ?? 0, b?.revenue ?? 0);
    const cogsPct = pct(l?.cogs ?? 0, b?.cogs ?? 0);
    const gpPct = pct(l?.grossProfit ?? 0, b?.grossProfit ?? 0);
    return {
      principal: p,
      "live revenue": l?.revenue ?? "(missing)",
      "bridge revenue": b?.revenue ?? "(missing)",
      "revenue Δ%": revenuePct,
      "live cogs": l?.cogs ?? "(missing)",
      "bridge cogs": b?.cogs ?? "(missing)",
      "cogs Δ%": cogsPct,
      "live GP": l?.grossProfit ?? "(missing)",
      "bridge GP": b?.grossProfit ?? "(missing)",
      "GP Δ%": gpPct,
      flag: [flagPct(revenuePct), flagPct(cogsPct), flagPct(gpPct)].filter(Boolean).join(" "),
    };
  });
  console.table(rows);
}

function printStockDiff(liveItems: Dataset["stockItems"], bridgeItems: PartialStockItem[]) {
  interface Rollup { value: number; volume: number; pcs: number }
  function rollupByPrincipal(items: { key: string; principal: string; openingValue: number; openingVolume: number; openingPcs: number }[]) {
    const byKey = new Map<string, Rollup & { principal: string }>();
    for (const item of items) {
      let r = byKey.get(item.key);
      if (!r) {
        r = { principal: item.principal, value: 0, volume: 0, pcs: 0 };
        byKey.set(item.key, r);
      }
      r.value += item.openingValue;
      r.volume += item.openingVolume;
      r.pcs += item.openingPcs;
    }
    return byKey;
  }

  const live = rollupByPrincipal(liveItems);
  const bridge = rollupByPrincipal(bridgeItems);
  const keys = Array.from(new Set([...live.keys(), ...bridge.keys()])).sort();

  console.log(
    `\n=== Stock (opening value/volume only — no run-rate/days-cover, needs SAP_Raw, deferred) ===`
  );
  const rows = keys.map((k) => {
    const l = live.get(k);
    const b = bridge.get(k);
    const valuePct = pct(l?.value ?? 0, b?.value ?? 0);
    const volumePct = pct(l?.volume ?? 0, b?.volume ?? 0);
    return {
      principal: l?.principal ?? b?.principal ?? k,
      "live value": l?.value ?? "(missing)",
      "bridge value": b?.value ?? "(missing)",
      "value Δ%": valuePct,
      "live volume": l?.volume ?? "(missing)",
      "bridge volume": b?.volume ?? "(missing)",
      "volume Δ%": volumePct,
      flag: [flagPct(valuePct), flagPct(volumePct)].filter(Boolean).join(" "),
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

  printSalesDiff("MTD", mtd, liveDataset, bridgeDataset);
  printSalesDiff("Last full month", lastMonth, liveDataset, bridgeDataset);
  printSalesDiff("YTD", ytd, liveDataset, bridgeDataset);
  printStockDiff(liveDataset.stockItems, bridgeOutput.stockItems);

  console.log(
    `\n[compare] Tolerance: ${TOLERANCE_PCT}% — rows marked ⚠ exceed it. Known gaps: no customer/rep breakdown, no stock run-rate/days-cover (needs SAP_Raw, deferred).`
  );
}

main().catch((err) => {
  console.error("[compare] FAILED:", err);
  process.exitCode = 1;
});

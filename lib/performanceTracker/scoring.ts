// Weighted-score, grade, and color-tier formulas — transcribed from both
// workbooks' Instructions tabs (see lib/performanceTracker/definitions.ts's
// own header comment for the exact source sheets). Nothing here is inferred;
// every formula below has a direct citation to the workbook cell/text it came
// from, and any place this implementation deliberately diverges from what the
// workbook's own formula literally did (as opposed to what its Instructions
// tab documented) is called out explicitly.

import { allMetricsFor, type MetricDefinition } from "./definitions";

export type Grade = "A" | "B" | "C" | "D" | "F";

/** HOD Instructions, "GRADE SCALE": A >=90%, B >=75%, C >=60%, D >=40%, F <40%.
 *  TL Instructions, "KPI Benchmarks": "Weighted Grade: A >=90%, B >=75%,
 *  C >=60%, D >=40%, F <40%" — identical scale, shared here. */
export function gradeFor(pct: number): Grade {
  if (pct >= 0.9) return "A";
  if (pct >= 0.75) return "B";
  if (pct >= 0.6) return "C";
  if (pct >= 0.4) return "D";
  return "F";
}

export type Tier = "good" | "warn" | "bad";

/** HOD Instructions, "COLOUR CODING": green >=100%, yellow 80-99%, red <80%.
 *  TL Instructions, "Colour Coding": "Green = on/above target... Yellow =
 *  80-99% of target... Red = below 80% target" for revenue/volume-style
 *  ratios — same rule, shared here. Strike Rate and OOS Rate have their own
 *  bespoke bands on the TL sheet (see strikeRateTier/oosRateTier below). */
export function vsTargetTier(ratio: number): Tier {
  if (ratio >= 1) return "good";
  if (ratio >= 0.8) return "warn";
  return "bad";
}

/** TL Instructions, "KPI Benchmarks": "Strike Rate: >=80% green, 60-79%
 *  yellow, <60% red." */
export function strikeRateTier(pct: number): Tier {
  if (pct >= 0.8) return "good";
  if (pct >= 0.6) return "warn";
  return "bad";
}

/** TL Instructions, "KPI Benchmarks": "OOS Rate: <=5% green, 5-10% yellow,
 *  >10% red." Lower is better, unlike every other rate here. */
export function oosRateTier(pct: number): Tier {
  if (pct <= 0.05) return "good";
  if (pct <= 0.1) return "warn";
  return "bad";
}

export interface MetricInput {
  target: number | null;
  actual: number | null;
}

/** HOD's overall weighted score. Instructions, "WEIGHTED SCORING SYSTEM":
 *  each weighted metric contributes (actual/target) * weight, except Team
 *  Attrition which is inverted (MAX(0, 1 - rate) * weight — the sheet's own
 *  formula for that cell: `=IFERROR(MAX(0,1-I21)*0.05,0)`), plus MD
 *  Discretionary (0-5%, added directly, never actual/target-based — "Not in
 *  formula - add manually to score if desired"). Total = 90% quantitative +
 *  up to 10% qualitative, matching "TOTAL: 90% quantitative + 10% qualitative". */
export function computeHodScore(
  metrics: Map<string, MetricInput>,
  mdDiscretionaryPct: number | null
): { pct: number; grade: Grade } {
  let score = 0;
  for (const m of allMetricsFor("HOD")) {
    if (!m.weight) continue;
    const input = resolvedInput(m, metrics);
    if (!input || input.target === null || input.target === 0 || input.actual === null) continue;
    const ratio = input.actual / input.target;
    score += m.invert ? Math.max(0, 1 - ratio) * m.weight : ratio * m.weight;
  }
  score += Math.max(0, Math.min(mdDiscretionaryPct ?? 0, 0.05));
  return { pct: score, grade: gradeFor(score) };
}

/** A computed ("ratio") metric like GP Margin %/Numeric Distribution % has no
 *  target/actual of its own in the stored rows — resolve it from its two
 *  named source metrics instead, so computeHodScore can weight it the same
 *  way as any directly-entered metric. */
function resolvedInput(m: MetricDefinition, metrics: Map<string, MetricInput>): MetricInput | null {
  if (!m.computedFrom) return metrics.get(m.key) ?? null;
  const num = metrics.get(m.computedFrom.numerator)?.actual ?? null;
  const den = metrics.get(m.computedFrom.denominator)?.actual ?? null;
  if (num === null || den === null || den === 0) return null;
  // Both target and actual collapse to the same live ratio here — there's no
  // separate "target ratio" input for a computed line — so its own
  // actual/target contribution to computeHodScore is just that ratio itself
  // (den cancels: (num/den) / 1). Only meaningful when the underlying
  // metric's own weight treats a plain ratio as "vs 100%", which is how every
  // computed metric in HOD_SECTIONS (GP Margin %, Numeric Distribution %,
  // Strike Rate %, Collection Efficiency %) is used.
  return { target: 1, actual: num / den };
}

export interface RepRowInput {
  volumeTarget: number | null;
  volumeActual: number | null;
  revenueTarget: number | null;
  revenueActual: number | null;
  lppcTarget: number | null;
  lppcActual: number | null;
  callsPlanned: number | null;
  callsMade: number | null;
  productiveCalls: number | null;
  oosAudited: number | null;
  oosInstances: number | null;
}

export interface RepRowScore {
  volumePct: number;
  revenuePct: number;
  lppcPct: number;
  strikeRatePct: number;
  oosScore: number;
  weightedPct: number;
  grade: Grade;
}

/** Per-rep weighted score, TL "Rep Scorecard" sheet. Instructions: "Weighted
 *  score = Revenue 40% + Distribution 30% + Strike Rate 20% + OOS Score 10%".
 *  The sheet's own formula (`=(J5*0.4)+(IFERROR(L5/K5,0)*0.3)+(Q5*0.2)+(MAX(0,1-M5)*0.1)`)
 *  uses LPPC% (Lines Per Productive Call — a real distribution-breadth proxy)
 *  as the 30% "Distribution" term, which this reproduces exactly. Its OOS
 *  term, however, was wired to `MAX(0, 1 - <LPPC% column>)` — reusing the
 *  same LPPC% a second time under a different label, not a real OOS
 *  measure (the sheet has no per-rep OOS column at all to reference; OOS
 *  only exists team-wide, in the separate "OOS & Dist Audit" log). That's a
 *  template wiring bug, not intended weighting — verified against the
 *  Instructions text itself, which describes a genuine "OOS Score", not a
 *  second LPPC term. This implementation uses the real thing instead:
 *  oosScore = 1 - (oosInstances / oosAudited), 0 when nothing's been audited
 *  yet (no audit data is a gap to close, not a free pass). */
export function computeRepScore(row: RepRowInput): RepRowScore {
  const volumePct = ratio(row.volumeActual, row.volumeTarget);
  const revenuePct = ratio(row.revenueActual, row.revenueTarget);
  const lppcPct = ratio(row.lppcActual, row.lppcTarget);
  const strikeRatePct = ratio(row.productiveCalls, row.callsMade);
  const oosScore = row.oosAudited && row.oosAudited > 0 ? Math.max(0, 1 - (row.oosInstances ?? 0) / row.oosAudited) : 0;
  const weightedPct = revenuePct * 0.4 + lppcPct * 0.3 + strikeRatePct * 0.2 + oosScore * 0.1;
  return { volumePct, revenuePct, lppcPct, strikeRatePct, oosScore, weightedPct, grade: gradeFor(weightedPct) };
}

function ratio(actual: number | null | undefined, target: number | null | undefined): number {
  if (!actual || !target) return 0;
  return actual / target;
}

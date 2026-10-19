// Data-quality checks run on every refresh; each is an alert the screen can show.
import { CLEAN_REGIONS } from "./config";
import type { DedupPair, DedupRecord, ExtractRow, FactRow } from "./types";

export interface QualityCheck {
  area: string;
  issue: string;
  evidence: string;
  severity: "High" | "Medium" | "Info";
}

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const fmt = (n: number) => n.toLocaleString("en-KE");

export function qualityChecks(raw: ExtractRow[], fact: FactRow[], records: DedupRecord[], pairs: DedupPair[], context: { monthLabel: string; sourcesWithoutCalls: string[] }): QualityCheck[] {
  const out: QualityCheck[] = [];
  const add = (area: string, issue: string, evidence: string, severity: QualityCheck["severity"]) => out.push({ area, issue, evidence, severity });

  // 1. The extract's combined average sums averages across rows with the same outlet NAME, which drives its Tier.
  const withCombined = raw.filter((r) => r.combinedAvg !== null);
  if (withCombined.length) {
    const byName = new Map<string, number>();
    for (const r of withCombined) {
      const key = r.outlet.trim().toLowerCase();
      byName.set(key, (byName.get(key) ?? 0) + (r.avgSales ?? 0));
    }
    const matches = withCombined.filter((r) => Math.abs((byName.get(r.outlet.trim().toLowerCase()) ?? 0) - (r.combinedAvg as number)) < 0.05).length / withCombined.length;
    const seen = new Set<string>();
    let changed = 0;
    let total = 0;
    for (const f of fact) {
      if (seen.has(f.masterId)) continue;
      seen.add(f.masterId);
      total++;
      if (f.tier !== null && f.tier !== f.tierCorrected) changed++;
    }
    add("Outlet averages & tiers", "Combined Avg Sales (Outlet) sums averages across rows with the same outlet NAME", `${pct(matches)} of rows match the name-keyed sum; ${pct(total ? changed / total : 0, 0)} of unique outlets change tier when corrected`, matches > 0.5 ? "High" : "Info");
  }

  // 2. Strike outcome gaps.
  const noOutcome = new Map<string, number>();
  for (const r of raw) if ((r.calls ?? 0) > 0 && r.productive === null) noOutcome.set(r.principal, (noOutcome.get(r.principal) ?? 0) + 1);
  if (noOutcome.size) add("Strike data", `Calls without a productive-call outcome in ${context.monthLabel}`, [...noOutcome.entries()].map(([p, n]) => `${p}: ${fmt(n)}`).join(", "), "High");
  if (context.sourcesWithoutCalls.length) add("Strike data", `No call data in ${context.monthLabel} for ${context.sourcesWithoutCalls.join(", ")}`, "These sources are left out of strike rate rather than counted as 0%", "Medium");
  const byPrincipal = new Map<string, { p: number; k: number }>();
  for (const f of fact) {
    const e = byPrincipal.get(f.principal) ?? { p: 0, k: 0 };
    e.p += f.productiveCalls;
    e.k += f.callsWithOutcome;
    byPrincipal.set(f.principal, e);
  }
  for (const [p, e] of byPrincipal) if (e.k > 100 && e.p / e.k > 0.99) add("Strike data", `${p} strike above 99%`, "Calls may be logged only when an order is taken", "Medium");

  // 3. Duplicates.
  const merged = records.filter((r) => !r.isMaster).length;
  const groups = new Set(records.filter((r) => r.clusterSize > 1).map((r) => r.cluster)).size;
  add("Outlet identity", "Duplicate outlet records", `${fmt(merged)} records merged into ${fmt(groups)} groups; ${fmt(pairs.filter((p) => p.confidence === "Review").length)} pairs to review`, merged ? "High" : "Info");

  // 4. Region field.
  const regions = new Set(raw.map((r) => r.region));
  const estates = raw.filter((r) => !CLEAN_REGIONS.includes(r.region) && r.region !== "Upper Mountain (SA)").length;
  add("Geography", "Region field mixes regions and estates", `${regions.size} values; ${fmt(estates)} rows carry an estate name`, "Medium");

  // 5. Routes.
  const blank = (rows: ExtractRow[]) => (rows.length ? rows.filter((r) => r.route === null || r.route === "").length / rows.length : 0);
  add("Routes", "Route missing", `${pct(blank(raw.filter((r) => r.isDirect)), 0)} of direct rows, ${pct(blank(raw.filter((r) => !r.isDirect)), 0)} of distributor rows`, "Medium");

  // 6. Dates: days since purchase against the last purchase date.
  const dated = raw.filter((r) => r.lastPurchase !== null && r.daysSince !== null);
  if (dated.length) {
    const latest = dated.reduce((m, r) => (r.lastPurchase as string) > m ? (r.lastPurchase as string) : m, "0000-00-00");
    const minDays = Math.min(...dated.map((r) => r.daysSince as number));
    let mismatched = 0;
    for (const r of dated) {
      const recalculated = Math.round((Date.parse(latest) - Date.parse(r.lastPurchase as string)) / 86400000);
      if (Math.abs(recalculated - ((r.daysSince as number) - minDays)) > 1) mismatched++;
    }
    add("Dates", "Days Since Purchase vs Last Purchase", `${pct(mismatched / dated.length)} of rows disagree`, mismatched / dated.length > 0.01 ? "High" : "Info");
  }
  return out;
}

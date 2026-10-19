// Derived columns used by every metric: clean region, true average invoice, corrected tier, run-rate, strike inputs and flags.
import type { CollapsedRow } from "./collapse";
import { CLEAN_REGIONS, RECENCY_EDGES, RECENCY_LABELS, REGION_ALIASES, RETAIL_TIERS, RETAIL_TOP, STRIKE_EDGES, STRIKE_LABELS, WHOLESALE_TIERS, WHOLESALE_TOP } from "./config";
import { KdTree } from "./kdtree";
import type { CoverageRoute, FactRow } from "./types";

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Tier bands on the TRUE average invoice (the extract's own Tier uses a name-keyed sum of averages and must not be reused). */
export function tierOf(avgInvoice: number | null, channel: string | null): string {
  const v = avgInvoice ?? 0;
  const spec = channel === "Wholesale" ? WHOLESALE_TIERS : RETAIL_TIERS;
  for (const [limit, label, inclusive] of spec) if (inclusive ? v <= limit : v < limit) return label;
  return channel === "Wholesale" ? WHOLESALE_TOP : RETAIL_TOP;
}

/** (lo, hi] bands, like pandas.cut; undefined when the value falls outside every band. */
function cut(value: number | null, edges: number[], labels: string[]): string | undefined {
  if (value === null || Number.isNaN(value)) return undefined;
  for (let i = 0; i < labels.length; i++) if (value > edges[i] && value <= edges[i + 1]) return labels[i];
  return undefined;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v).sort()[0];
}

/** The region field mixes regions and estate names: keep real regions, give the rest the mode of their 7 nearest GPS neighbours. */
function cleanRegions(rows: { region: string | null; lat: number | null; lon: number | null }[]): string[] {
  const reg: (string | null)[] = rows.map((r) => {
    const aliased = r.region === null ? null : (REGION_ALIASES[r.region] ?? r.region);
    return aliased !== null && CLEAN_REGIONS.includes(aliased) ? aliased : null;
  });
  const hasGps = rows.map((r) => r.lat !== null && r.lat !== 0);
  const refIdx: number[] = [];
  const missIdx: number[] = [];
  rows.forEach((_, i) => {
    if (hasGps[i] && reg[i] !== null) refIdx.push(i);
    else if (hasGps[i] && reg[i] === null) missIdx.push(i);
  });
  if (refIdx.length && missIdx.length) {
    const tree = new KdTree(refIdx.map((i) => ({ x: rows[i].lat as number, y: rows[i].lon as number })));
    for (const i of missIdx) {
      const near = tree.nearest(rows[i].lat as number, rows[i].lon as number, 7);
      reg[i] = mode(near.map((n) => reg[refIdx[n]] as string));
    }
  }
  return reg.map((r) => r ?? "Nairobi");
}

export function enrich(unique: CollapsedRow[]): FactRow[] {
  const n = unique.length;
  // Region (Clean): the master outlet's first region, cleaned by GPS neighbours, then the master's first cleaned value.
  const firstRegion = new Map<string, string | null>();
  for (const r of unique) if (!firstRegion.has(r.masterId) || (firstRegion.get(r.masterId) === null && r.region !== null)) firstRegion.set(r.masterId, r.region);
  const cleaned = cleanRegions(unique.map((r) => ({ region: firstRegion.get(r.masterId) ?? null, lat: r.lat, lon: r.lon })));
  const regionOfMaster = new Map<string, string>();
  unique.forEach((r, i) => {
    if (!regionOfMaster.has(r.masterId)) regionOfMaster.set(r.masterId, cleaned[i]);
  });

  // True average invoice per unique outlet: sum(sales) / sum(transactions).
  const sums = new Map<string, { s: number; t: number }>();
  for (const r of unique) {
    const e = sums.get(r.masterId) ?? { s: 0, t: 0 };
    e.s += r.sales;
    e.t += r.tx;
    sums.set(r.masterId, e);
  }
  const avgInvoice = new Map<string, number | null>();
  for (const [id, e] of sums) avgInvoice.set(id, e.t > 0 ? round(e.s / e.t, 2) : null);

  // Coverage route per master outlet: direct only / direct + distributor / distributor only.
  const routes = new Map<string, { any: boolean; all: boolean }>();
  for (const r of unique) {
    const e = routes.get(r.masterId) ?? { any: false, all: true };
    e.any = e.any || r.isDirect;
    e.all = e.all && r.isDirect;
    routes.set(r.masterId, e);
  }

  const facts: FactRow[] = unique.map((r) => {
    const avgInv = avgInvoice.get(r.masterId) ?? null;
    const hasOutcome = r.productive !== null;
    const callsWithOutcome = hasOutcome ? (r.calls ?? 0) : 0;
    const productiveCalls = r.productive ?? 0;
    const unproductiveCalls = callsWithOutcome - productiveCalls;
    const recentCalls = r.productiveRecent !== null ? (r.callsRecent ?? 0) : 0;
    const recentProductive = r.productiveRecent ?? 0;
    const invoice = r.tx > 0 ? Math.max(0, r.sales / r.tx) : 0;
    const route = routes.get(r.masterId)!;
    const coverageRoute: CoverageRoute = route.all ? "Direct only" : route.any ? "Direct + Distributor" : "Distributor only";
    return {
      ...r,
      regionClean: regionOfMaster.get(r.masterId) ?? "Nairobi",
      avgInvoiceUnique: avgInv,
      tierCorrected: tierOf(avgInv, r.channel),
      monthlyRunRate: r.monthsBuying === null ? null : round(r.sales / Math.max(1, r.monthsBuying), 2),
      callsWithOutcome,
      productiveCalls,
      unproductiveCalls,
      unproductiveValue: round(unproductiveCalls * invoice, 2),
      recentCalls,
      recentProductive,
      recentStrike: recentCalls > 0 ? round((recentProductive / recentCalls) * 100, 1) : null,
      lapsing: (r.daysSince ?? -1) >= 30 && r.daysSince !== null,
      consistent: r.periods3 === 3,
      newOutlet: r.tenure === "Less than 1 month" || r.tenure === "1 to 3 months",
      coverageRoute,
      recencyBand: cut(r.daysSince, RECENCY_EDGES, RECENCY_LABELS) ?? "nan",
      strikeBand: cut(r.strike, STRIKE_EDGES, STRIKE_LABELS) ?? "No outcome data",
      uniqueOutletCount: 0,
      outletPrincipalCount: 0,
      teamLeader: r.teamLeader ?? "Unassigned",
      repRegion: r.repRegion ?? "Unassigned",
      repSubregion: r.repSubregion ?? "Unassigned",
    };
  });

  // The first row per master outlet (direct first, then highest sales) carries the unique-outlet count; likewise per outlet x principal.
  const order = facts.map((_, i) => i).sort((a, b) => Number(facts[b].isDirect) - Number(facts[a].isDirect) || facts[b].sales - facts[a].sales || a - b);
  const seenMaster = new Set<string>();
  const seenPair = new Set<string>();
  for (const i of order) {
    const f = facts[i];
    if (!seenMaster.has(f.masterId)) {
      seenMaster.add(f.masterId);
      f.uniqueOutletCount = 1;
    }
    const pairKey = `${f.masterId}\u0000${f.principal}`;
    if (!seenPair.has(pairKey)) {
      seenPair.add(pairKey);
      f.outletPrincipalCount = 1;
    }
  }
  void n;
  return facts;
}

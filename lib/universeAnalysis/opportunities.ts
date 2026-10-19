// Opportunity sizing and named target lists. Pools are counted from the data; capture rates come from the assumptions (editable what-ifs).
import { DEFAULT_ASSUMPTIONS, LOW_STRIKE_MIN_CALLS, LOW_STRIKE_THRESHOLD, TARGET_LIST_SIZE, type Assumptions } from "./config";
import { groupBy } from "./metrics";
import type { FactRow } from "./types";

const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0);

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

interface OutletView {
  masterId: string;
  route: string;
  seg: string | null;
  region: string;
  mrr: number;
}

function firstNonNull<T>(values: (T | null)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}

export interface SegmentPool {
  segment: string;
  outlets: number;
  benchmarkMonthly: number;
  directOutletsBehindBenchmark: number;
  poolMonthly: number;
  annualValue: number;
}

export interface CrossSellRow {
  principal: string;
  segment: string;
  buying: number;
  whiteSpace: number;
  benchmarkMonthly: number;
  annualValue: number;
}

export interface Opportunities {
  distributorToDirect: { pool: number; annualValue: number; bySegment: SegmentPool[]; byRegion: Record<string, number> };
  crossSell: { pool: number; annualValue: number; rows: CrossSellRow[] };
  frequency: { pool: number; monthlyValue: number; annualValue: number };
  lapsing: { pool: number; monthlyAtRisk: number; annualValue: number };
  unproductiveCalls: { pool: number; value: number; recoverable: number; note: string };
  routeOverlap: { outletsMultiRep: number; duplicateAssignments: number; repRoutesFreed: number };
  totalNewRevenue: number;
}

export function sizeOpportunities(rows: FactRow[], a: Assumptions = DEFAULT_ASSUMPTIONS): Opportunities {
  // One view per master outlet; the attributes come from its direct row first.
  const ordered = rows.map((_, i) => i).sort((x, y) => Number(rows[y].isDirect) - Number(rows[x].isDirect) || x - y);
  const outlets = new Map<string, OutletView>();
  const segSeen = new Map<string, string | null>();
  for (const i of ordered) {
    const r = rows[i];
    const o = outlets.get(r.masterId);
    if (o) {
      o.mrr += r.monthlyRunRate ?? 0;
      if (segSeen.get(r.masterId) === null && r.segment !== null) {
        segSeen.set(r.masterId, r.segment);
        o.seg = r.segment;
      }
    } else {
      outlets.set(r.masterId, { masterId: r.masterId, route: r.coverageRoute, seg: r.segment, region: r.regionClean, mrr: r.monthlyRunRate ?? 0 });
      segSeen.set(r.masterId, r.segment);
    }
  }
  const outletList = [...outlets.values()];

  // 1. Distributor-only -> direct. Benchmark: the median non-Mars direct monthly purchase per outlet in the same segment.
  const nm = groupBy(rows.filter((r) => r.isDirect && r.principal !== "Mars-Nairobi" && r.segment !== null), (r) => [r.masterId, r.segment]).map((g) => ({ segment: g.key[1] as string | null, mrr: sum(g.rows.map((r) => r.monthlyRunRate)) }));
  const bench = new Map<string, { median: number | null; size: number }>();
  for (const g of groupBy(nm, (x) => [x.segment])) bench.set(String(g.key[0]), { median: median(g.rows.map((x) => x.mrr)), size: g.rows.length });
  const distOnly = outletList.filter((o) => o.route === "Distributor only");
  const bySegment: SegmentPool[] = groupBy(distOnly.filter((o) => o.seg !== null), (o) => [o.seg])
    .map((g) => {
      const segment = g.key[0] as string;
      const b = bench.get(String(segment));
      const outletsN = g.rows.length;
      const med = b?.median ?? 0;
      return { segment, outlets: outletsN, benchmarkMonthly: med, directOutletsBehindBenchmark: b?.size ?? 0, poolMonthly: outletsN * med, annualValue: outletsN * med * a.distributorToDirect * a.monthsToAnnualise };
    })
    .filter((p) => p.outlets >= 20 && p.directOutletsBehindBenchmark >= 15 && p.benchmarkMonthly !== null);
  const byRegion: Record<string, number> = {};
  for (const o of distOnly) byRegion[o.region] = (byRegion[o.region] ?? 0) + 1;

  // 2. Cross-sell inside the direct base.
  const nairobi = new Set(a.nairobiPrincipals);
  const dn = rows.filter((r) => r.isDirect && nairobi.has(r.principal));
  const dnSorted = dn.map((r, i) => ({ r, i })).sort((x, y) => y.r.sales - x.r.sales || x.i - y.i).map((x) => x.r);
  const du = new Map<string, { seg: string | null; prs: Set<string> }>();
  for (const r of dnSorted) {
    const e = du.get(r.masterId);
    if (e) {
      e.prs.add(r.principal);
      if (e.seg === null && r.segment !== null) e.seg = r.segment;
    } else du.set(r.masterId, { seg: r.segment, prs: new Set([r.principal]) });
  }
  const crossRows: CrossSellRow[] = [];
  for (const p of a.crossSellPrincipals) {
    const med = groupBy(rows.filter((r) => r.isDirect && r.principal === p), (r) => [r.segment]);
    for (const g of med) {
      const segment = g.key[0] as string | null;
      if (g.rows.length < a.minSegmentOutletsForBenchmark || segment === null) continue;
      const benchmark = median(g.rows.map((r) => r.monthlyRunRate)) ?? 0;
      const whiteSpace = [...du.values()].filter((o) => o.seg === segment && !o.prs.has(p)).length;
      if (whiteSpace >= a.minPoolForCrossSell) crossRows.push({ principal: p, segment, buying: g.rows.length, whiteSpace, benchmarkMonthly: benchmark, annualValue: whiteSpace * benchmark * a.crossSell * a.monthsToAnnualise });
    }
  }

  // 3. Frequency (active but irregular) and 4. lapsing (31-89 days), on the direct rows.
  const direct = rows.filter((r) => r.isDirect);
  const irregular = direct.filter((r) => !r.lapsing && r.periods3 !== null && r.periods3 < 3);
  const lost = sum(irregular.map((r) => ((r.monthlyRunRate ?? 0) * (3 - (r.periods3 as number))) / 3));
  const lapsing = direct.filter((r) => r.lapsing);
  const atRisk = sum(lapsing.map((r) => r.monthlyRunRate));

  // 5. Unproductive calls (the period covered by the call data; not annualised).
  const unproductiveValue = sum(rows.map((r) => r.unproductiveValue));

  // 6. Route overlap (capacity): direct outlets served by more than one rep.
  const repsByOutlet = new Map<string, Set<string>>();
  const outletsByRep = new Map<string, Set<string>>();
  for (const r of direct) {
    if (!repsByOutlet.has(r.masterId)) repsByOutlet.set(r.masterId, new Set());
    if (r.rep !== null) {
      repsByOutlet.get(r.masterId)!.add(r.rep);
      (outletsByRep.get(r.rep) ?? outletsByRep.set(r.rep, new Set()).get(r.rep)!).add(r.masterId);
    }
  }
  const repCounts = [...repsByOutlet.values()].map((s) => s.size);
  const medOutlets = median([...outletsByRep.values()].map((s) => s.size)) ?? 1;
  const duplicateAssignments = repCounts.reduce((s, c) => s + Math.max(0, c - 1), 0);

  const result: Opportunities = {
    distributorToDirect: { pool: bySegment.reduce((s, p) => s + p.outlets, 0), annualValue: bySegment.reduce((s, p) => s + p.annualValue, 0), bySegment, byRegion },
    crossSell: { pool: crossRows.reduce((s, r) => s + r.whiteSpace, 0), annualValue: crossRows.reduce((s, r) => s + r.annualValue, 0), rows: crossRows },
    frequency: { pool: irregular.length, monthlyValue: lost, annualValue: lost * a.frequencyRecovery * a.monthsToAnnualise },
    lapsing: { pool: lapsing.length, monthlyAtRisk: atRisk, annualValue: atRisk * a.lapsingWinback * a.monthsToAnnualise },
    unproductiveCalls: {
      pool: sum(rows.map((r) => r.unproductiveCalls)),
      value: unproductiveValue,
      recoverable: unproductiveValue * a.unproductiveCallConversion,
      note: "Value in the month analysed, not annualised.",
    },
    routeOverlap: { outletsMultiRep: repCounts.filter((c) => c > 1).length, duplicateAssignments, repRoutesFreed: duplicateAssignments / medOutlets },
    totalNewRevenue: 0,
  };
  result.totalNewRevenue = result.distributorToDirect.annualValue + result.crossSell.annualValue + result.frequency.annualValue;
  return result;
}

export type TargetAction = "Convert to direct" | "Win back (lapsing)" | "Fix strike rate" | "Cross-sell";

export interface TargetRow {
  action: TargetAction;
  masterOutletId: string;
  outlet: string;
  principals: string;
  segment: string | null;
  region: string;
  rep: string | null;
  daysSincePurchase: number | null;
  salesYtd: number;
  monthlyRunRate: number | null;
  strikeRatePct: number | null;
  why: string;
}

function nlargest<T>(items: T[], n: number, value: (item: T) => number | null): T[] {
  return items
    .map((item, i) => ({ item, i, v: value(item) }))
    .filter((x): x is { item: T; i: number; v: number } => x.v !== null && !Number.isNaN(x.v))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.item);
}

export function targetLists(rows: FactRow[], n = TARGET_LIST_SIZE, lowMinCalls = LOW_STRIKE_MIN_CALLS, lowThreshold = LOW_STRIKE_THRESHOLD): TargetRow[] {
  const out: TargetRow[] = [];
  // One view per master outlet in master-id order (as a groupby would give).
  const outlets = groupBy(rows, (r) => [r.masterId]).map((g) => {
    const list = g.rows;
    const days = list.map((r) => r.daysSince).filter((v): v is number => v !== null);
    return {
      masterId: g.key[0] as string,
      route: list[0].coverageRoute,
      outlet: list[0].outlet,
      seg: firstNonNull(list.map((r) => r.segment)),
      region: list[0].regionClean,
      sales: sum(list.map((r) => r.sales)),
      mrr: sum(list.map((r) => r.monthlyRunRate)),
      prs: [...new Set(list.map((r) => r.principal))].sort().join(", "),
      rep: firstNonNull(list.map((r) => r.rep)),
      days: days.length ? Math.min(...days) : null,
      principalCount: new Set(list.filter((r) => r.isDirect).map((r) => r.principal)).size,
    };
  });
  for (const o of nlargest(outlets.filter((x) => x.route === "Distributor only"), n, (x) => x.sales)) {
    out.push({ action: "Convert to direct", masterOutletId: o.masterId, outlet: o.outlet, principals: o.prs, segment: o.seg, region: o.region, rep: o.rep, daysSincePurchase: o.days, salesYtd: o.sales, monthlyRunRate: o.mrr, strikeRatePct: null, why: "Distributor-only outlet; open a direct account for non-Mars principals" });
  }
  for (const r of nlargest(rows.filter((x) => x.isDirect && x.lapsing), n, (x) => x.monthlyRunRate)) {
    out.push({ action: "Win back (lapsing)", masterOutletId: r.masterId, outlet: r.outlet, principals: r.principal, segment: r.segment, region: r.regionClean, rep: r.rep, daysSincePurchase: r.daysSince, salesYtd: r.sales, monthlyRunRate: r.monthlyRunRate, strikeRatePct: r.strike, why: `No purchase for ${Math.trunc(r.daysSince ?? 0)} days` });
  }
  for (const r of nlargest(rows.filter((x) => x.recentCalls >= lowMinCalls && x.recentStrike !== null && x.recentStrike < lowThreshold), n, (x) => x.recentCalls - x.recentProductive)) {
    out.push({ action: "Fix strike rate", masterOutletId: r.masterId, outlet: r.outlet, principals: r.principal, segment: r.segment, region: r.regionClean, rep: r.rep, daysSincePurchase: r.daysSince, salesYtd: r.sales, monthlyRunRate: r.monthlyRunRate, strikeRatePct: r.recentStrike, why: `${Math.trunc(r.recentCalls - r.recentProductive)} of ${Math.trunc(r.recentCalls)} calls in the last 3 months without an order` });
  }
  for (const o of nlargest(outlets.filter((x) => x.principalCount === 1), n, (x) => x.mrr)) {
    out.push({ action: "Cross-sell", masterOutletId: o.masterId, outlet: o.outlet, principals: o.prs, segment: o.seg, region: o.region, rep: o.rep, daysSincePurchase: o.days, salesYtd: o.sales, monthlyRunRate: o.mrr, strikeRatePct: null, why: "Single-principal direct outlet" });
  }
  return out;
}

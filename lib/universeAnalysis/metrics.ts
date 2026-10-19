// Metric functions over the enriched unique-outlet rows. The golden rules (the bugs the old pivots had):
//   * averages are ratios of sums: avg invoice = SUM(sales) / SUM(transactions); strike = SUM(productive) / SUM(calls with outcome);
//   * outlets are counted on the master outlet id (de-duplicated), never on a raw outlet id and never by summing per-row counts;
//   * reps are DISTINCT reps, never a sum of a per-row "reps serving".
import { DEFAULT_REP_FLAGS, type RepFlags } from "./config";
import type { CoverageRoute, FactRow } from "./types";

/** Filter name -> the value of a fact row (the dimensions the analysis can slice by). */
export const DIMENSIONS = {
  principal: (r: FactRow) => r.principal,
  route_class: (r: FactRow) => r.routeClass,
  channel: (r: FactRow) => r.channel,
  region: (r: FactRow) => r.regionClean,
  segment: (r: FactRow) => r.segment,
  team_leader: (r: FactRow) => r.teamLeader,
  rep: (r: FactRow) => r.rep,
  rep_region: (r: FactRow) => r.repRegion,
  rep_subregion: (r: FactRow) => r.repSubregion,
  tenure: (r: FactRow) => r.tenure,
  recency: (r: FactRow) => r.recencyBand,
  tier: (r: FactRow) => r.tierCorrected,
  coverage: (r: FactRow) => r.coverageRoute,
  source: (r: FactRow) => r.source,
  consistency: (r: FactRow) => (r.periods3 === null ? null : String(r.periods3)),
  strike_band: (r: FactRow) => r.strikeBand,
  territory: (r: FactRow) => r.territory,
} as const;

export type DimensionName = keyof typeof DIMENSIONS;
export type Filters = Partial<Record<DimensionName, string[]>>;

export function applyFilters(rows: FactRow[], filters: Filters | undefined): FactRow[] {
  if (!filters) return rows;
  const active = (Object.entries(filters) as [DimensionName, string[] | undefined][]).filter(([k, v]) => v && v.length > 0 && k in DIMENSIONS);
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every(([k, v]) => (v as string[]).includes(String(DIMENSIONS[k](r))) ));
}

/** Python's built-in round(): halves go to the even neighbour. */
export function pyRound(value: number): number {
  const f = Math.floor(value);
  const diff = value - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last, like pandas groupby(dropna=False)
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function groupBy<T>(rows: T[], keyOf: (row: T) => (string | number | null)[]): { key: (string | number | null)[]; rows: T[] }[] {
  const map = new Map<string, { key: (string | number | null)[]; rows: T[] }>();
  for (const row of rows) {
    const key = keyOf(row);
    const id = JSON.stringify(key);
    const g = map.get(id);
    if (g) g.rows.push(row);
    else map.set(id, { key, rows: [row] });
  }
  return [...map.values()].sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const c = compare(a.key[i], b.key[i]);
      if (c !== 0) return c;
    }
    return 0;
  });
}

const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0);
const mean = (values: boolean[]) => (values.length ? values.filter(Boolean).length / values.length : NaN);
const nunique = <T>(values: (T | null)[]) => new Set(values.filter((v) => v !== null)).size;
const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

export interface SummaryRow {
  outlets: number;
  outletPrincipalPairs: number;
  sales: number;
  invoices: number;
  monthlyRunRate: number;
  callsWithOutcome: number;
  productiveCalls: number;
  unproductiveCalls: number;
  unproductiveValue: number;
  reps: number;
  consistentShare: number;
  lapsingShare: number;
  newOutlets: number;
  avgInvoice: number | null;
  avgSalesPerOutlet: number | null;
  strikeRate: number | null;
  outletsPerRep: number | null;
}

export function summariseRows(rows: FactRow[]): SummaryRow {
  const sales = sum(rows.map((r) => r.sales));
  const invoices = sum(rows.map((r) => r.tx));
  const outlets = nunique(rows.map((r) => r.masterId));
  const callsWithOutcome = sum(rows.map((r) => r.callsWithOutcome));
  const productiveCalls = sum(rows.map((r) => r.productiveCalls));
  const reps = nunique(rows.map((r) => r.rep));
  return {
    outlets,
    outletPrincipalPairs: sum(rows.map((r) => r.outletPrincipalCount)),
    sales,
    invoices,
    monthlyRunRate: sum(rows.map((r) => r.monthlyRunRate)),
    callsWithOutcome,
    productiveCalls,
    unproductiveCalls: sum(rows.map((r) => r.unproductiveCalls)),
    unproductiveValue: sum(rows.map((r) => r.unproductiveValue)),
    reps,
    consistentShare: mean(rows.map((r) => r.consistent)),
    lapsingShare: mean(rows.map((r) => r.lapsing)),
    newOutlets: rows.filter((r) => r.newOutlet).length,
    avgInvoice: ratio(sales, invoices),
    avgSalesPerOutlet: ratio(sales, outlets),
    strikeRate: ratio(productiveCalls, callsWithOutcome),
    outletsPerRep: ratio(outlets, reps),
  };
}

export type SummaryGroup = { key: Record<string, string | number | null> } & SummaryRow;

/** The core aggregator behind every table: outlets, value, invoices, strike, unproductive value, health, grouped by 0..2 dimensions. */
export function summarise(rows: FactRow[], by: DimensionName[] = []): SummaryGroup[] {
  if (by.length === 0) return [{ key: {}, ...summariseRows(rows) }];
  return groupBy(rows, (r) => by.map((d) => DIMENSIONS[d](r) as string | null)).map((g) => ({
    key: Object.fromEntries(by.map((d, i) => [d, g.key[i]])),
    ...summariseRows(g.rows),
  }));
}

// ---------------------------------------------------------------- universe
export interface UniverseSummary {
  uniqueOutlets: number;
  directOutlets: number;
  directReach: number | null;
  distributorOnly: number;
  sales: number;
  coverage: { route: CoverageRoute; outlets: number; sales: number; monthlyRunRate: number; medianMonthly: number }[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function universe(rows: FactRow[]): UniverseSummary {
  const outlets = new Map<string, { route: CoverageRoute; sales: number; mrr: number }>();
  for (const r of rows) {
    const o = outlets.get(r.masterId);
    if (o) {
      o.sales += r.sales;
      o.mrr += r.monthlyRunRate ?? 0;
    } else outlets.set(r.masterId, { route: r.coverageRoute, sales: r.sales, mrr: r.monthlyRunRate ?? 0 });
  }
  const routes: CoverageRoute[] = ["Direct only", "Direct + Distributor", "Distributor only"];
  const coverage = routes.map((route) => {
    const list = [...outlets.values()].filter((o) => o.route === route);
    return { route, outlets: list.length, sales: sum(list.map((o) => o.sales)), monthlyRunRate: sum(list.map((o) => o.mrr)), medianMonthly: median(list.map((o) => o.mrr)) };
  });
  const total = outlets.size;
  const direct = coverage[0].outlets + coverage[1].outlets;
  return { uniqueOutlets: total, directOutlets: direct, directReach: total ? direct / total : null, distributorOnly: coverage[2].outlets, sales: sum([...outlets.values()].map((o) => o.sales)), coverage };
}

export interface CoverageByRow {
  value: string | null;
  directOnly: number;
  directPlusDistributor: number;
  distributorOnly: number;
  universe: number;
  direct: number;
  directReach: number;
}

/** Universe vs direct reach by an outlet attribute (segment, region, ...). The attribute comes from the outlet's direct row first. */
export function coverageBy(rows: FactRow[], dim: DimensionName): CoverageByRow[] {
  const order = rows.map((_, i) => i).sort((a, b) => Number(rows[b].isDirect) - Number(rows[a].isDirect) || a - b);
  const byOutlet = new Map<string, { value: string | null; route: CoverageRoute }>();
  for (const i of order) {
    const r = rows[i];
    const existing = byOutlet.get(r.masterId);
    const value = DIMENSIONS[dim](r) as string | null;
    if (!existing) byOutlet.set(r.masterId, { value, route: r.coverageRoute });
    else if (existing.value === null && value !== null) existing.value = value; // groupby.first() skips nulls
  }
  const groups = groupBy([...byOutlet.values()], (o) => [o.value]);
  const out = groups.map((g) => {
    const directOnly = g.rows.filter((o) => o.route === "Direct only").length;
    const both = g.rows.filter((o) => o.route === "Direct + Distributor").length;
    const dist = g.rows.filter((o) => o.route === "Distributor only").length;
    const universeCount = directOnly + both + dist;
    return { value: g.key[0] as string | null, directOnly, directPlusDistributor: both, distributorOnly: dist, universe: universeCount, direct: directOnly + both, directReach: universeCount ? (directOnly + both) / universeCount : 0 };
  });
  return out.sort((a, b) => b.universe - a.universe);
}

export function concentration(rows: FactRow[], channel?: string): { topShareOfOutlets: number; outlets: number; shareOfSales: number }[] {
  const x = channel ? rows.filter((r) => r.channel === channel) : rows;
  const byOutlet = new Map<string, number>();
  for (const r of x) byOutlet.set(r.masterId, (byOutlet.get(r.masterId) ?? 0) + r.sales);
  const s = [...byOutlet.values()].sort((a, b) => b - a);
  const total = sum(s);
  const n = s.length;
  return [0.01, 0.05, 0.1, 0.2, 0.5].map((p) => {
    const k = Math.max(1, pyRound(n * p));
    return { topShareOfOutlets: p, outlets: k, shareOfSales: total ? sum(s.slice(0, k)) / total : 0 };
  });
}

/** Share of the ROW principal's direct outlets that also buy the COLUMN principal directly. */
export function crossBuyMatrix(rows: FactRow[], principals: string[]): { principals: string[]; matrix: number[][] } {
  const byOutlet = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.isDirect) continue;
    const set = byOutlet.get(r.masterId) ?? new Set<string>();
    set.add(r.principal);
    byOutlet.set(r.masterId, set);
  }
  const present = new Set([...byOutlet.values()].flatMap((s) => [...s]));
  const cols = principals.filter((p) => present.has(p));
  const matrix = cols.map((row) => {
    const owners = [...byOutlet.values()].filter((s) => s.has(row));
    return cols.map((col) => (owners.length ? owners.filter((s) => s.has(col)).length / owners.length : 0));
  });
  return { principals: cols, matrix };
}

// ---------------------------------------------------------------- scorecards
export interface PrincipalScore extends SummaryRow {
  principal: string | null;
  directOutlets: number;
  directReps: number;
  sfaStrikeRate: number | null;
  crossBuyRate: number | null;
  wholesaleShareOfSales: number;
  shareOfSales: number;
}

export function principalScorecard(rows: FactRow[]): PrincipalScore[] {
  const direct = rows.filter((r) => r.isDirect);
  const outletPrincipals = new Map<string, Set<string>>();
  for (const r of direct) (outletPrincipals.get(r.masterId) ?? outletPrincipals.set(r.masterId, new Set()).get(r.masterId)!).add(r.principal);
  const totalSales = sum(rows.map((r) => r.sales));
  const scores = summarise(rows, ["principal"]).map((s) => {
    const principal = s.key.principal as string;
    const own = rows.filter((r) => r.principal === principal);
    const ownDirect = direct.filter((r) => r.principal === principal);
    const directOutletIds = [...new Set(ownDirect.map((r) => r.masterId))];
    const sfa = own.map((r) => r.principalStrike).find((v) => v !== null && v !== undefined);
    return {
      ...s,
      principal,
      directOutlets: directOutletIds.length,
      directReps: nunique(ownDirect.map((r) => r.rep)),
      sfaStrikeRate: sfa === undefined || sfa === null ? null : sfa / 100,
      crossBuyRate: directOutletIds.length ? directOutletIds.filter((id) => (outletPrincipals.get(id)?.size ?? 0) > 1).length / directOutletIds.length : null,
      wholesaleShareOfSales: s.sales ? sum(own.filter((r) => r.channel === "Wholesale").map((r) => r.sales)) / s.sales : 0,
      shareOfSales: totalSales ? s.sales / totalSales : 0,
    };
  });
  return scores.sort((a, b) => b.sales - a.sales);
}

export interface TeamLeaderScore extends SummaryRow {
  teamLeader: string | null;
  principals: string;
}

export function teamLeaderScorecard(rows: FactRow[]): TeamLeaderScore[] {
  return summarise(rows, ["team_leader"])
    .map((s) => {
      const tl = s.key.team_leader as string | null;
      const own = rows.filter((r) => r.teamLeader === tl);
      return { ...s, teamLeader: tl, principals: [...new Set(own.map((r) => r.principal))].sort().join(", ") };
    })
    .sort((a, b) => b.sales - a.sales);
}

function modeOf(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === 0) return null;
  const top = Math.max(...counts.values());
  return [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v).sort()[0];
}

export type RepFlag = "OK" | "Non-field / van" | "Thin route" | "Low strike" | "High lapsing" | "Low consistency";

export interface RepRow extends SummaryRow {
  routeType: "Direct" | "Distributor";
  rep: string | null;
  teamLeader: string | null;
  principals: string;
  region: string | null;
  flag: RepFlag;
}

export function repProductivity(rows: FactRow[], flags: RepFlags = DEFAULT_REP_FLAGS): RepRow[] {
  const typed = rows.map((r) => ({ r, routeType: (r.isDirect ? "Direct" : "Distributor") as "Direct" | "Distributor" }));
  const out = groupBy(typed, (x) => [x.routeType, x.r.rep]).map((g) => {
    const list = g.rows.map((x) => x.r);
    const s = summariseRows(list);
    const rep = g.key[1] as string | null;
    const name = String(rep).toLowerCase();
    const nonField = flags.nonFieldKeywords.some((k) => name.includes(k));
    const flag: RepFlag = nonField
      ? "Non-field / van"
      : s.outlets < flags.thinRouteOutlets
        ? "Thin route"
        : s.strikeRate !== null && s.strikeRate < flags.lowStrike
          ? "Low strike"
          : s.lapsingShare > flags.highLapsing
            ? "High lapsing"
            : s.consistentShare < flags.lowConsistency
              ? "Low consistency"
              : "OK";
    return { ...s, routeType: g.key[0] as "Direct" | "Distributor", rep, teamLeader: modeOf(list.map((r) => r.teamLeader)), principals: [...new Set(list.map((r) => r.principal))].sort().join(", "), region: modeOf(list.map((r) => r.regionClean)), flag };
  });
  return out.sort((a, b) => (a.routeType === b.routeType ? b.sales - a.sales : a.routeType < b.routeType ? -1 : 1));
}

/** Outlet x principal pairs, direct vs distributor, by a health band (recency band, buying tenure, ...). */
export function health(rows: FactRow[], dim: DimensionName): { value: string | null; routeType: "Direct" | "Distributor"; pairs: number; monthlyRunRate: number; strikeRate: number | null }[] {
  const typed = rows.map((r) => ({ r, routeType: (r.isDirect ? "Direct" : "Distributor") as "Direct" | "Distributor" }));
  return groupBy(typed, (x) => [DIMENSIONS[dim](x.r) as string | null, x.routeType]).map((g) => {
    const list = g.rows.map((x) => x.r);
    return { value: g.key[0] as string | null, routeType: g.key[1] as "Direct" | "Distributor", pairs: list.length, monthlyRunRate: sum(list.map((r) => r.monthlyRunRate)), strikeRate: ratio(sum(list.map((r) => r.productiveCalls)), sum(list.map((r) => r.callsWithOutcome))) };
  });
}

// ---------------------------------------------------------------- coverage detail (Universe Diagnosis tables)
export interface CoverageDetailRow {
  value: string | null;
  universe: number;
  direct: number;
  directReach: number;
  alsoViaDistributor: number;
  distributorOnly: number;
  directSales: number;
  distributorSales: number;
  avgDirectInvoice: number | null;
  medianDirectMonthly: number | null;
  directReps: number;
  distributorReps: number;
  universePerDirectRep: number | null;
  distributorOnlyPerDirectRep: number | null;
  /** Reach band: under 30% under-covered, under 60% partial, otherwise strong. */
  status: "Under-covered" | "Partial" | "Strong";
}

/** Reach, value and rep capacity by an outlet attribute (segment, region, ...): how the universe is reached and where Pinefrost is thin. */
export function coverageDetail(rows: FactRow[], dim: DimensionName): CoverageDetailRow[] {
  const base = coverageBy(rows, dim);
  return base.map((b) => {
    const own = rows.filter((r) => (DIMENSIONS[dim](r) as string | null) === b.value);
    const direct = own.filter((r) => r.isDirect);
    const dist = own.filter((r) => !r.isDirect);
    const directTx = sum(direct.map((r) => r.tx));
    const directOutletMrr = [...groupBy(direct, (r) => [r.masterId])].map((g) => sum(g.rows.map((r) => r.monthlyRunRate)));
    const directReps = nunique(direct.map((r) => r.rep));
    return {
      value: b.value,
      universe: b.universe,
      direct: b.direct,
      directReach: b.directReach,
      alsoViaDistributor: b.directPlusDistributor,
      distributorOnly: b.distributorOnly,
      directSales: sum(direct.map((r) => r.sales)),
      distributorSales: sum(dist.map((r) => r.sales)),
      avgDirectInvoice: directTx > 0 ? sum(direct.map((r) => r.sales)) / directTx : null,
      medianDirectMonthly: directOutletMrr.length ? median(directOutletMrr) : null,
      directReps,
      distributorReps: nunique(dist.map((r) => r.rep)),
      universePerDirectRep: directReps ? b.universe / directReps : null,
      distributorOnlyPerDirectRep: directReps ? b.distributorOnly / directReps : null,
      status: b.directReach < 0.3 ? "Under-covered" : b.directReach < 0.6 ? "Partial" : "Strong",
    };
  });
}

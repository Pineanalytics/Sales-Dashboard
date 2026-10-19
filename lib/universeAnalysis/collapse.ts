// Collapse the extract rows to one row per (master outlet, principal, route class), combining the duplicate records of a merged outlet.
import type { DedupRecord, ExtractRow } from "./types";

export interface CollapsedRow extends ExtractRow {
  masterId: string;
}

const nums = (values: (number | null)[]) => values.filter((v): v is number => v !== null && !Number.isNaN(v));
const sum = (values: (number | null)[]): number | null => {
  const v = nums(values);
  return v.length ? v.reduce((a, b) => a + b, 0) : null; // pandas sum(min_count=1)
};
const min = (values: (number | null)[]): number | null => {
  const v = nums(values);
  return v.length ? Math.min(...v) : null;
};
const max = (values: (number | null)[]): number | null => {
  const v = nums(values);
  return v.length ? Math.max(...v) : null;
};
const minDate = (values: (string | null)[]): string | null => {
  const v = values.filter((d): d is string => !!d);
  return v.length ? v.reduce((a, b) => (a < b ? a : b)) : null;
};
const maxDate = (values: (string | null)[]): string | null => {
  const v = values.filter((d): d is string => !!d);
  return v.length ? v.reduce((a, b) => (a > b ? a : b)) : null;
};
function first<T>(values: (T | null)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}
const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export function collapse(rows: ExtractRow[], records: DedupRecord[]): CollapsedRow[] {
  const recByKey = new Map(records.map((r) => [r.recKey, r]));
  const mergedMasters = new Set(records.filter((r) => r.clusterSize > 1).map((r) => r.masterId));
  const d: CollapsedRow[] = rows.map((row) => {
    const masterId = recByKey.get(row.recKey)!.masterId;
    if (!mergedMasters.has(masterId)) return { ...row, masterId };
    const m = recByKey.get(masterId)!;
    return { ...row, masterId, outlet: m.outlet, segment: m.segment ?? (null as unknown as string), channel: m.channel ?? (null as unknown as string), region: m.region ?? (null as unknown as string), territory: m.territory ?? (null as unknown as string), lat: m.lat, lon: m.lon };
  });

  const keyOf = (r: CollapsedRow) => `${r.masterId}\u0000${r.principal}\u0000${r.routeClass}`;
  const groups = new Map<string, CollapsedRow[]>();
  for (const r of d) {
    const list = groups.get(keyOf(r));
    if (list) list.push(r);
    else groups.set(keyOf(r), [r]);
  }
  const single: CollapsedRow[] = [];
  const multiKeys: string[] = [];
  const grouped = new Map<string, CollapsedRow[]>();
  for (const r of d) {
    const list = groups.get(keyOf(r))!;
    if (list.length === 1) single.push(r);
  }
  for (const [key, list] of groups) {
    if (list.length > 1) {
      multiKeys.push(key);
      // Highest sales first, so the descriptive "first" fields come from the strongest record (stable).
      grouped.set(key, list.map((r, i) => ({ r, i })).sort((a, b) => b.r.sales - a.r.sales || a.i - b.i).map((x) => x.r));
    }
  }
  multiKeys.sort();
  const merged: CollapsedRow[] = multiKeys.map((key) => {
    const g = grouped.get(key)!;
    const f = <K extends keyof ExtractRow>(field: K): ExtractRow[K] => first(g.map((r) => r[field] as unknown as never)) as unknown as ExtractRow[K];
    const salesTotal = g.reduce((s, r) => s + r.sales, 0);
    const txTotal = g.reduce((s, r) => s + r.tx, 0);
    const calls = sum(g.map((r) => r.calls));
    const productive = sum(g.map((r) => r.productive));
    const callsRecent = sum(g.map((r) => r.callsRecent));
    const productiveRecent = sum(g.map((r) => r.productiveRecent));
    const daysSince = min(g.map((r) => r.daysSince));
    const periods3 = max(g.map((r) => r.periods3));
    return {
      ...g[0],
      source: f("source"),
      outletId: f("outletId"),
      outlet: f("outlet"),
      channel: f("channel"),
      segment: f("segment"),
      region: f("region"),
      territory: f("territory"),
      route: f("route"),
      rep: f("rep"),
      lat: f("lat"),
      lon: f("lon"),
      tenure: f("tenure"),
      tier: f("tier"),
      combinedAvg: f("combinedAvg"),
      matchId: f("matchId"),
      matchConf: f("matchConf"),
      teamLeader: f("teamLeader"),
      repRegion: f("repRegion"),
      repSubregion: f("repSubregion"),
      principalStrike: f("principalStrike"),
      recKey: g[0].recKey,
      sales: salesTotal,
      tx: txTotal,
      calls,
      productive,
      callsRecent,
      productiveRecent,
      daysSince,
      lastPurchase: maxDate(g.map((r) => r.lastPurchase)),
      periods3,
      monthsBuying: max(g.map((r) => r.monthsBuying)),
      buyingSince: minDate(g.map((r) => r.buyingSince)),
      avgSales: txTotal > 0 ? round(salesTotal / txTotal, 2) : null,
      consistency: periods3 === 3 ? "Consistent" : "Non-consistent",
      bought30: daysSince !== null && daysSince < 30 ? "Yes" : "No",
      strike: calls !== null && productive !== null && calls > 0 ? round((productive / calls) * 100, 1) : null,
      masterId: g[0].masterId,
    } as CollapsedRow;
  });
  return [...single, ...merged];
}

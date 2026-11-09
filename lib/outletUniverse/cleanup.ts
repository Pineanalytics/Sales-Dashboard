// The universe cleanup, done once when the universe is compiled so that every reader of OutletUniverse (the Active Outlets module and its extracts, the
// universe analysis, the coverage frequency extract, the Coaching bridge, and anything built on top of them) sees the same cleaned data:
//   - territoryClean: the territory with its spellings unified by name and by where the outlets sit (lib/locationUnify: "THIKA", "Thika - MBSR",
//     "Nairobi-Thika" -> "Thika"; small typos and spacing variants of a bigger place join it);
//   - shopId, shopSize, shopConfidence: outlets that are the same shop, within and across systems, by GPS point and cleaned name or by the match id
//     (lib/universeAnalysis/dedup), share one shopId (the master outlet's record key, e.g. "PINE-12345"). Nothing is removed: every outlet keeps its own row
//     and a reader that counts shops groups by shopId.
import { buildLocationMap, type LocationStat } from "@/lib/locationUnify/cluster";
import { deduplicate } from "@/lib/universeAnalysis/dedup";
import { recordKey } from "@/lib/universeAnalysis/pipeline";
import type { ExtractRow } from "@/lib/universeAnalysis/types";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "./normalize";

const CELL_DEG = 0.002;

export interface CleanupFields {
  territoryClean: string | null;
  shopId: string | null;
  shopSize: number | null;
  shopConfidence: string | null;
}

/** The part of a universe row the cleanup reads. */
export interface CleanupInput {
  source: OutletSource;
  outletKey: string;
  principal: string;
  outletName: string;
  salesRole: string;
  channel: string;
  segment: string;
  region: string;
  territory: string;
  route: string | null;
  repName: string | null;
  latitude: number | null;
  longitude: number | null;
  lastPurchaseDate: Date | null;
  sales: number;
  transactions: number;
  matchId?: string | null;
  matchConfidence?: string | null;
}

const validPoint = (lat: number | null, lon: number | null): lat is number => lat !== null && lat !== 0 && lat >= -5 && lat <= 5 && lon !== null && lon >= 33 && lon <= 43;

/** Per territory name: its rows, the rows with a usable GPS point and their mean, which systems it appears in, and the ~220 m map cells its outlets sit in
 *  (the same statistics lib/locationUnify/source.ts reads from the stored table, here taken from the rows being compiled). */
export function locationStatsFromRows(rows: Pick<CleanupInput, "territory" | "source" | "latitude" | "longitude">[]): LocationStat[] {
  const stats = new Map<string, { rows: number; gps: number; lat: number; lon: number; sources: Set<string>; cells: Map<string, number> }>();
  for (const row of rows) {
    const name = row.territory ?? "";
    if (name.trim() === "") continue;
    const stat = stats.get(name) ?? stats.set(name, { rows: 0, gps: 0, lat: 0, lon: 0, sources: new Set(), cells: new Map() }).get(name)!;
    stat.rows += 1;
    stat.sources.add(row.source);
    if (validPoint(row.latitude, row.longitude)) {
      stat.gps += 1;
      stat.lat += row.latitude;
      stat.lon += row.longitude as number;
      const cell = `${Math.round(row.latitude / CELL_DEG)}|${Math.round((row.longitude as number) / CELL_DEG)}`;
      stat.cells.set(cell, (stat.cells.get(cell) ?? 0) + 1);
    }
  }
  return [...stats.entries()].map(([name, s]) => ({ name, rows: s.rows, gps: s.gps, lat: s.gps ? s.lat / s.gps : 0, lon: s.gps ? s.lon / s.gps : 0, sources: [...s.sources].sort(), cells: s.cells }));
}

function extractRow(row: CleanupInput, territory: string, now: Date): ExtractRow {
  const label = OUTLET_SOURCE_LABELS[row.source] ?? row.source;
  const daysSince = row.lastPurchaseDate ? Math.max(0, Math.floor((now.getTime() - row.lastPurchaseDate.getTime()) / 86_400_000)) : null;
  return {
    source: label,
    outletId: String(row.outletKey).trim(),
    outlet: row.outletName,
    principal: row.principal,
    routeClass: row.salesRole,
    channel: row.channel,
    segment: row.segment,
    region: row.region,
    territory,
    route: row.route,
    rep: row.repName,
    lat: row.latitude,
    lon: row.longitude,
    lastPurchase: null,
    daysSince,
    sales: row.sales,
    avgSales: null,
    tx: row.transactions,
    buyingSince: null,
    monthsBuying: null,
    tenure: null,
    periods3: null,
    consistency: null,
    tier: null,
    combinedAvg: null,
    bought30: null,
    matchId: row.matchId ?? null,
    matchConf: row.matchConfidence ?? null,
    teamLeader: null,
    repRegion: null,
    repSubregion: null,
    calls: null,
    productive: null,
    strike: null,
    callsRecent: null,
    productiveRecent: null,
    principalStrike: null,
    recKey: recordKey(label, String(row.outletKey)),
    isDirect: row.salesRole === "Primary Sales",
  };
}

/** Adds the cleanup columns to every row of the universe (all outlets, active or dormant). */
export function withCleanup<T extends CleanupInput>(rows: T[], now: Date = new Date()): (T & CleanupFields)[] {
  if (rows.length === 0) return [];
  const map = buildLocationMap(locationStatsFromRows(rows));
  const canonical = new Map(map.mapping.map((m) => [m.raw, m.canonical]));
  const clean = (territory: string) => (territory.trim() === "" ? "" : canonical.get(territory) ?? territory);
  const { records } = deduplicate(rows.map((row) => extractRow(row, clean(row.territory), now)));
  const byKey = new Map(records.map((r) => [r.recKey, r]));
  return rows.map((row) => {
    const record = byKey.get(recordKey(OUTLET_SOURCE_LABELS[row.source] ?? row.source, String(row.outletKey)));
    const territoryClean = clean(row.territory);
    return {
      ...row,
      territoryClean: territoryClean === "" ? null : territoryClean,
      shopId: record?.masterId ?? null,
      shopSize: record?.clusterSize ?? null,
      shopConfidence: record && record.clusterSize > 1 ? record.confidence || null : null,
    };
  });
}

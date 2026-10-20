// Loads the territory statistics from the compiled outlet universe, builds the unified location map, and caches it for ten minutes.
// Every consumer (the Active Outlets extract, the Universe analysis, the Coaching bridge feed) reads the same map, so a place has one name everywhere.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildLocationMap, type LocationMap, type LocationMapRow, type LocationStat } from "./cluster";

const TTL_MS = 10 * 60_000;
const CELL_DEG = 0.002;

export async function loadLocationStats(): Promise<LocationStat[]> {
  const [names, cells] = await Promise.all([
    prisma.$queryRaw<{ name: string; sources: string[]; rows: number; gps: number; lat: number | null; lon: number | null }[]>(Prisma.sql`
      SELECT COALESCE(territory, '') AS name, ARRAY_AGG(DISTINCT source) AS sources, COUNT(*)::int AS rows,
             (COUNT(*) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0 AND latitude BETWEEN -5 AND 5 AND longitude BETWEEN 33 AND 43))::int AS gps,
             AVG(latitude) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0 AND latitude BETWEEN -5 AND 5 AND longitude BETWEEN 33 AND 43)::double precision AS lat,
             AVG(longitude) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0 AND latitude BETWEEN -5 AND 5 AND longitude BETWEEN 33 AND 43)::double precision AS lon
      FROM "OutletUniverse" GROUP BY COALESCE(territory, '')
    `),
    prisma.$queryRaw<{ name: string; cy: number; cx: number; n: number }[]>(Prisma.sql`
      SELECT COALESCE(territory, '') AS name, ROUND(latitude / ${CELL_DEG})::int AS cy, ROUND(longitude / ${CELL_DEG})::int AS cx, COUNT(*)::int AS n
      FROM "OutletUniverse"
      WHERE latitude IS NOT NULL AND latitude <> 0 AND latitude BETWEEN -5 AND 5 AND longitude BETWEEN 33 AND 43
      GROUP BY COALESCE(territory, ''), 2, 3
    `),
  ]);
  const stats = new Map<string, LocationStat>();
  for (const n of names) stats.set(n.name, { name: n.name, rows: n.rows, gps: n.gps, lat: n.lat ?? 0, lon: n.lon ?? 0, sources: n.sources, cells: new Map() });
  for (const c of cells) stats.get(c.name)?.cells.set(`${c.cy}|${c.cx}`, c.n);
  return [...stats.values()].filter((s) => s.name.trim() !== "");
}

export interface UnifiedLocations {
  map: LocationMap;
  byRaw: Map<string, LocationMapRow>;
  builtAt: string;
}

let cache: { at: number; value: Promise<UnifiedLocations> } | null = null;

export function getUnifiedLocations(): Promise<UnifiedLocations> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const value = (async (): Promise<UnifiedLocations> => {
      const map = buildLocationMap(await loadLocationStats());
      return { map, byRaw: new Map(map.mapping.map((m) => [m.raw, m])), builtAt: new Date().toISOString() };
    })();
    value.catch(() => {
      cache = null;
    });
    cache = { at: Date.now(), value };
  }
  return cache.value;
}

export interface CleanLocation {
  canonical: string;
  groupId: string | null;
  /** How the name was unified ("same name", "name + coordinates", ...), or null when it stands alone or was not known. */
  match: string | null;
  confidence: string | null;
}

/** The unified name of a raw territory. A name the map has not seen (a new one since it was built) is returned as it is. */
export function cleanLocation(unified: UnifiedLocations, raw: string | null | undefined): CleanLocation {
  const name = (raw ?? "").trim();
  const row = unified.byRaw.get(name) ?? unified.byRaw.get(raw ?? "");
  if (!row) return { canonical: name, groupId: null, match: null, confidence: null };
  return { canonical: row.canonical, groupId: row.groupId, match: row.method === "unchanged" ? null : row.method, confidence: row.confidence };
}

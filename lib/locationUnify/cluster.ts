// Unify location names. Two signals, in order of trust:
//   1. the name: the same name after normalisation ("THIKA", "Thika - MBSR"), or one name that continues another without a distinguishing word ("Imara" and
//      "Imara Daima"), or a spelling variant;
//   2. the coordinates: where each name's outlets physically sit. A name merge is only accepted when the two places are close; names that share the same
//      cells on the map are reported as related even when their wording is unrelated, and a name sitting inside another's area is reported as a sub-area.
// Nothing is changed in the source data: the result is a mapping from each raw name to one canonical name, plus the relations behind it.
import { similarity } from "@/lib/universeAnalysis/similarity";
import { DISTINGUISHING_TOKENS, displayName, normalizeLocation, type LocationKind } from "./normalize";

export interface LocationStat {
  name: string;
  rows: number;
  /** Rows with a usable GPS point, and the mean of those points. */
  gps: number;
  lat: number;
  lon: number;
  sources: string[];
  /** Outlets per ~220 m map cell ("cy|cx"). */
  cells: Map<string, number>;
}

export type MergeConfidence = "High" | "Medium";
export type MergeMethod = "same name" | "name + coordinates" | "spelling + coordinates" | "address -> nearest area";

export interface LocationMapRow {
  raw: string;
  canonical: string;
  groupId: string;
  kind: LocationKind;
  rows: number;
  gps: number;
  lat: number | null;
  lon: number | null;
  sources: string[];
  /** How this name came to its canonical name; "unchanged" when it stands alone. */
  method: MergeMethod | "unchanged";
  confidence: MergeConfidence | null;
}

export interface LocationGroup {
  groupId: string;
  canonical: string;
  rawNames: string[];
  rows: number;
  gps: number;
  lat: number | null;
  lon: number | null;
  /** Mean distance of its outlets from the centre, in km (how spread the place is). */
  radiusKm: number | null;
}

export type RelationKind = "possible variant" | "sub-area" | "shares coordinates";

export interface LocationRelation {
  a: string;
  b: string;
  kind: RelationKind;
  distanceKm: number | null;
  /** Share of the smaller place's outlets that sit in cells the other also occupies (0..1), when both have GPS. */
  overlap: number | null;
  note: string;
}

export interface LocationMap {
  mapping: LocationMapRow[];
  groups: LocationGroup[];
  relations: LocationRelation[];
}

export interface ClusterOptions {
  /** Names that continue another name are merged when their centres are within this distance (km), or within spreadFactor x the sum of their own spreads if larger. */
  mergeRadiusKm: number;
  /** A name with fewer GPS points than this is only merged when its points are within smallNameRadiusKm of the other place. */
  minGps: number;
  smallNameRadiusKm: number;
  spreadFactor: number;
  coordinateOverlap: number;
  coordinateMinGps: number;
  addressRadiusKm: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { mergeRadiusKm: 3, minGps: 3, smallNameRadiusKm: 1.5, spreadFactor: 0.6, coordinateOverlap: 0.6, coordinateMinGps: 20, addressRadiusKm: 2 };

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return 6371 * Math.sqrt(dLat * dLat + dLon * dLon);
}

const CELL_DEG = 0.002;

interface Group {
  id: number;
  key: string;
  tokens: string[];
  names: LocationStat[];
  rows: number;
  gps: number;
  lat: number;
  lon: number;
  cells: Map<string, number>;
}

function addGroup(g: Group, s: LocationStat) {
  g.names.push(s);
  g.rows += s.rows;
  const total = g.gps + s.gps;
  if (total > 0) {
    g.lat = (g.lat * g.gps + s.lat * s.gps) / total;
    g.lon = (g.lon * g.gps + s.lon * s.gps) / total;
  }
  g.gps = total;
  for (const [cell, n] of s.cells) g.cells.set(cell, (g.cells.get(cell) ?? 0) + n);
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function buildLocationMap(stats: LocationStat[], options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS): LocationMap {
  const normalized = stats.map((s) => ({ s, n: normalizeLocation(s.name) }));
  const places = normalized.filter((x) => x.n.kind === "place");

  // 1. Same normalised name -> one group.
  const byKey = new Map<string, Group>();
  for (const { s, n } of places) {
    let g = byKey.get(n.key);
    if (!g) {
      g = { id: byKey.size, key: n.key, tokens: n.tokens, names: [], rows: 0, gps: 0, lat: 0, lon: 0, cells: new Map() };
      byKey.set(n.key, g);
    }
    addGroup(g, s);
  }
  const groups = [...byKey.values()];
  const uf = new UnionFind(groups.length);
  const mergeInfo = new Map<number, { method: MergeMethod; confidence: MergeConfidence }>(); // group id -> how it joined its cluster
  const relations: LocationRelation[] = [];
  const dist = (a: Group, b: Group) => (a.gps >= 1 && b.gps >= 1 ? distanceKm(a.lat, a.lon, b.lat, b.lon) : null);
  // How spread a place is: the mean distance of its outlets from its centre (a town covers kilometres, an estate a few hundred metres).
  const radiusCache = new Map<number, number>();
  const radius = (g: Group): number => {
    const cached = radiusCache.get(g.id);
    if (cached !== undefined) return cached;
    let total = 0;
    let n = 0;
    for (const [cell, count] of g.cells) {
      const [cy, cx] = cell.split("|").map(Number);
      total += count * distanceKm(g.lat, g.lon, cy * CELL_DEG, cx * CELL_DEG);
      n += count;
    }
    const r = n ? total / n : 0;
    radiusCache.set(g.id, r);
    return r;
  };

  // 2. Name relations inside buckets that share a first token (continuations) or a first two letters (spellings).
  const byFirstToken = new Map<string, Group[]>();
  const byPrefix = new Map<string, Group[]>();
  for (const g of groups) {
    (byFirstToken.get(g.tokens[0]) ?? byFirstToken.set(g.tokens[0], []).get(g.tokens[0])!).push(g);
    const prefix = g.key.replace(/ /g, "").slice(0, 2);
    (byPrefix.get(prefix) ?? byPrefix.set(prefix, []).get(prefix)!).push(g);
  }
  for (const bucket of byFirstToken.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, b] = bucket[i].tokens.length <= bucket[j].tokens.length ? [bucket[i], bucket[j]] : [bucket[j], bucket[i]];
        if (a.tokens.length === b.tokens.length || !a.tokens.every((t, k) => t === b.tokens[k])) continue;
        const extra = b.tokens.slice(a.tokens.length);
        const distinguishing = extra.some((t) => DISTINGUISHING_TOKENS.has(t) || /^\d+$/.test(t));
        const d = dist(a, b);
        const known = d !== null;
        const small = Math.min(a.gps, b.gps) < options.minGps;
        const limit = small ? options.smallNameRadiusKm : Math.max(options.mergeRadiusKm, options.spreadFactor * (radius(a) + radius(b)));
        if (!distinguishing && known && d <= limit) {
          uf.union(a.id, b.id);
          mergeInfo.set(a.id, { method: "name + coordinates", confidence: d <= 1 ? "High" : "Medium" });
          mergeInfo.set(b.id, { method: "name + coordinates", confidence: d <= 1 ? "High" : "Medium" });
        } else {
          relations.push({
            a: a.key,
            b: b.key,
            kind: distinguishing ? "sub-area" : "possible variant",
            distanceKm: d === null ? null : Math.round(d * 10) / 10,
            overlap: null,
            note: distinguishing ? `"${extra.join(" ")}" marks a different place` : known ? `${d!.toFixed(1)} km apart: too far to merge on the name alone` : "no GPS point to confirm",
          });
        }
      }
    }
  }
  for (const bucket of byPrefix.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (uf.find(a.id) === uf.find(b.id)) continue;
        const ca = a.key.replace(/ /g, "");
        const cb = b.key.replace(/ /g, "");
        if (ca.length < 5 || cb.length < 5 || Math.abs(ca.length - cb.length) > 2) continue;
        if (a.key.replace(/\D/g, "") !== b.key.replace(/\D/g, "")) continue; // "githurai 44" and "githurai 45" are different places
        if (similarity(ca, cb) < 0.85) continue;
        const d = dist(a, b);
        if (a.gps >= options.minGps && b.gps >= options.minGps && d !== null && d <= options.mergeRadiusKm) {
          uf.union(a.id, b.id);
          mergeInfo.set(a.id, { method: "spelling + coordinates", confidence: "Medium" });
          mergeInfo.set(b.id, { method: "spelling + coordinates", confidence: "Medium" });
        }
      }
    }
  }

  // 3. Coordinate relations between the clusters the names produced.
  const clusterOf = (g: Group) => uf.find(g.id);
  const clusters = new Map<number, Group>();
  for (const g of groups) {
    const root = clusterOf(g);
    let c = clusters.get(root);
    if (!c) {
      c = { id: root, key: "", tokens: [], names: [], rows: 0, gps: 0, lat: 0, lon: 0, cells: new Map() };
      clusters.set(root, c);
    }
    for (const s of g.names) addGroup(c, s);
  }
  // The cluster's key is its biggest group's key.
  const biggestKey = new Map<number, string>();
  for (const g of [...groups].sort((x, y) => y.rows - x.rows || (x.key < y.key ? -1 : 1))) if (!biggestKey.has(clusterOf(g))) biggestKey.set(clusterOf(g), g.key);
  for (const [root, c] of clusters) c.key = biggestKey.get(root) as string;

  const cellIndex = new Map<string, number[]>();
  const big = [...clusters.values()].filter((c) => c.gps >= options.coordinateMinGps);
  big.forEach((c, i) => {
    for (const cell of c.cells.keys()) {
      const [cy, cx] = cell.split("|").map(Number);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = cellIndex.get(`${cy + dy}|${cx + dx}`) ?? cellIndex.set(`${cy + dy}|${cx + dx}`, []).get(`${cy + dy}|${cx + dx}`)!;
          if (!list.includes(i)) list.push(i);
        }
      }
    }
  });
  const seenPairs = new Set<string>();
  for (const members of cellIndex.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const key = `${members[x]}|${members[y]}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const a = big[members[x]];
        const b = big[members[y]];
        // Overlap: the share of the smaller place's outlets that have the other place's outlets in their own cell or one of the 8 around it (so two
        // places a few metres apart are not separated by a cell boundary).
        const [lesser, other] = a.gps <= b.gps ? [a, b] : [b, a];
        let shared = 0;
        for (const [cell, n] of lesser.cells) {
          const [cy, cx] = cell.split("|").map(Number);
          let near = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near += other.cells.get(`${cy + dy}|${cx + dx}`) ?? 0;
          shared += Math.min(n, near);
        }
        const overlap = shared / lesser.gps;
        if (overlap < options.coordinateOverlap) continue;
        const ratio = Math.min(a.cells.size, b.cells.size) / Math.max(a.cells.size, b.cells.size);
        const d = distanceKm(a.lat, a.lon, b.lat, b.lon);
        const [small, large] = a.cells.size <= b.cells.size ? [a, b] : [b, a];
        if (ratio >= 0.4 && d <= 2.5) {
          const sharesWord = a.key.split(" ").some((t) => t.length > 2 && b.key.split(" ").includes(t));
          if (sharesWord) {
            // Same area, names that share a word: the same place named two ways.
            relations.push({ a: a.key, b: b.key, kind: "possible variant", distanceKm: Math.round(d * 10) / 10, overlap: Math.round(overlap * 100) / 100, note: "same area on the map and a shared word in the name" });
          } else {
            relations.push({ a: a.key, b: b.key, kind: "shares coordinates", distanceKm: Math.round(d * 10) / 10, overlap: Math.round(overlap * 100) / 100, note: "their outlets sit in the same part of the map under different names" });
          }
        } else {
          relations.push({ a: small.key, b: large.key, kind: "sub-area", distanceKm: Math.round(d * 10) / 10, overlap: Math.round(overlap * 100) / 100, note: `${small.key} sits inside ${large.key}` });
        }
      }
    }
  }

  // An address (a plus code, a street) is placed by what the address says and where its point falls: a known place named inside the text wins when it is
  // near; otherwise the area with the most outlets around the point; otherwise the nearest sizeable centre within a short distance.
  const cellVotes = new Map<string, Map<number, number>>();
  for (const c of clusters.values()) {
    for (const [cell, count] of c.cells) {
      const votes = cellVotes.get(cell) ?? cellVotes.set(cell, new Map()).get(cell)!;
      votes.set(c.id, (votes.get(c.id) ?? 0) + count);
    }
  }
  const namedClusters = [...clusters.values()].filter((c) => c.rows >= 100);
  const resolveAddress = (s: LocationStat, raw: string): Group | null => {
    if (s.gps <= 0) return null;
    const text = ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    let hinted: { c: Group; d: number } | null = null;
    for (const c of namedClusters) {
      if (!text.includes(` ${c.key} `)) continue;
      const d = distanceKm(s.lat, s.lon, c.lat, c.lon);
      if (d <= Math.max(4, 1.5 * radius(c)) && (!hinted || d < hinted.d)) hinted = { c, d };
    }
    if (hinted) return hinted.c;
    const cy = Math.round(s.lat / CELL_DEG);
    const cx = Math.round(s.lon / CELL_DEG);
    const tally = new Map<number, number>();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const votes = cellVotes.get(`${cy + dy}|${cx + dx}`);
        if (votes) for (const [id, n] of votes) tally.set(id, (tally.get(id) ?? 0) + n);
      }
    }
    let top: { id: number; n: number } | null = null;
    for (const [id, n] of tally) if (!top || n > top.n) top = { id, n };
    if (top && top.n >= 5) return clusters.get(top.id) ?? null;
    let nearest: { c: Group; d: number } | null = null;
    for (const c of clusters.values()) {
      if (c.gps < 30) continue;
      const d = distanceKm(s.lat, s.lon, c.lat, c.lon);
      if (d <= options.addressRadiusKm && (!nearest || d < nearest.d)) nearest = { c, d };
    }
    return nearest ? nearest.c : null;
  };

  // 4. Final canonical names.
  const canonicalOfCluster = new Map<number, string>();
  for (const [root, c] of clusters) canonicalOfCluster.set(root, displayName(c.key));
  const mapping: LocationMapRow[] = [];
  const groupOfName = new Map<string, Group>();
  for (const g of groups) for (const s of g.names) groupOfName.set(s.name, g);
  const centreOf = (c: Group) => (c.gps > 0 ? { lat: c.lat, lon: c.lon } : null);
  for (const { s, n } of normalized) {
    if (n.kind === "place") {
      const g = groupOfName.get(s.name)!;
      const root = clusterOf(g);
      const cluster = clusters.get(root)!;
      const canonical = canonicalOfCluster.get(root)!;
      const joined = cluster.names.length > 1 || g.names.length > 1;
      const info = mergeInfo.get(g.id);
      const method: LocationMapRow["method"] = !joined ? "unchanged" : info ? info.method : "same name";
      const confidence: MergeConfidence | null = !joined ? null : info ? info.confidence : "High";
      const centre = s.gps > 0 ? { lat: s.lat, lon: s.lon } : centreOf(cluster);
      mapping.push({ raw: s.name, canonical: s.name === canonical && !joined ? s.name : canonical, groupId: `L${String(root + 1).padStart(4, "0")}`, kind: "place", rows: s.rows, gps: s.gps, lat: centre?.lat ?? null, lon: centre?.lon ?? null, sources: s.sources, method, confidence });
    } else if (n.kind === "address") {
      const best = resolveAddress(s, n.raw);
      mapping.push({
        raw: s.name,
        canonical: best ? canonicalOfCluster.get(best.id)! : "Unresolved address",
        groupId: best ? `L${String(best.id + 1).padStart(4, "0")}` : "L0000",
        kind: "address",
        rows: s.rows,
        gps: s.gps,
        lat: s.gps > 0 ? s.lat : null,
        lon: s.gps > 0 ? s.lon : null,
        sources: s.sources,
        method: best ? "address -> nearest area" : "unchanged",
        confidence: best ? "Medium" : null,
      });
    } else {
      mapping.push({ raw: s.name, canonical: "Unspecified", groupId: "L0000", kind: "unspecified", rows: s.rows, gps: s.gps, lat: s.gps > 0 ? s.lat : null, lon: s.gps > 0 ? s.lon : null, sources: s.sources, method: "unchanged", confidence: null });
    }
  }

  const groupsOut: LocationGroup[] = [];
  const byCanonical = new Map<string, LocationGroup>();
  for (const m of mapping) {
    if (m.kind === "unspecified") continue;
    let g = byCanonical.get(m.canonical);
    if (!g) {
      g = { groupId: m.groupId, canonical: m.canonical, rawNames: [], rows: 0, gps: 0, lat: null, lon: null, radiusKm: null };
      byCanonical.set(m.canonical, g);
      groupsOut.push(g);
    }
    g.rawNames.push(m.raw);
    g.rows += m.rows;
  }
  for (const c of clusters.values()) {
    const g = byCanonical.get(canonicalOfCluster.get(c.id)!);
    if (!g) continue;
    g.gps = c.gps;
    g.lat = c.gps > 0 ? Math.round(c.lat * 1e5) / 1e5 : null;
    g.lon = c.gps > 0 ? Math.round(c.lon * 1e5) / 1e5 : null;
    if (c.gps > 0) {
      // Mean distance of the outlets' cells from the centre.
      let sum = 0;
      for (const [cell, n] of c.cells) {
        const [cy, cx] = cell.split("|").map(Number);
        sum += n * distanceKm(c.lat, c.lon, cy * CELL_DEG, cx * CELL_DEG);
      }
      g.radiusKm = Math.round((sum / Math.max(1, [...c.cells.values()].reduce((s, v) => s + v, 0))) * 10) / 10;
    }
  }
  return { mapping: mapping.sort((a, b) => b.rows - a.rows), groups: groupsOut.sort((a, b) => b.rows - a.rows), relations };
}

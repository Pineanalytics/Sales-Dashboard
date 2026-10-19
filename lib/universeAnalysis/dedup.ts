// Outlet de-duplication within and across source systems. Two evidence sources are combined:
//   1. GPS proximity + cleaned-name similarity (Pine, Upfield DataEdge, EABL DMS; Leverage has no GPS);
//   2. the extract's own Match ID (High confidence merges, Medium goes to review).
// Output: one record per source record (with its master outlet id) and every candidate pair with its decision.
import { DEFAULT_DEDUP, MASTER_SOURCE_PRIORITY, type DedupRules } from "./config";
import { similarity } from "./similarity";
import type { Confidence, DedupPair, DedupRecord, DedupResult, ExtractRow } from "./types";

export function cleanName(value: string, fillerRegex: string): string {
  let s = String(value).toLowerCase().replace(/'/g, "");
  s = s.replace(/[^a-z0-9 ]/g, " ");
  s = s.replace(new RegExp(fillerRegex, "g"), " ");
  return s.split(/\s+/).filter(Boolean).join(" ");
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** pandas groupby(...).first(): the first non-null value in the group's order. */
function firstNonNull<T>(values: (T | null | undefined)[]): T | null {
  for (const v of values) if (v !== null && v !== undefined && !(typeof v === "number" && Number.isNaN(v))) return v;
  return null;
}

interface WorkRecord extends Omit<DedupRecord, "cluster" | "clusterSize" | "masterId" | "isMaster" | "matchType" | "confidence" | "method" | "metresFromMaster" | "simToMaster"> {
  cluster?: string;
}

/** One row per RecKey, sorted by RecKey (as pandas groupby does); sales-descending order decides which row supplies the descriptive fields. */
function buildRecords(rows: ExtractRow[], rules: DedupRules): WorkRecord[] {
  const byKey = new Map<string, ExtractRow[]>();
  const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.sales - a.row.sales || a.index - b.index);
  for (const { row } of ordered) {
    const list = byKey.get(row.recKey);
    if (list) list.push(row);
    else byKey.set(row.recKey, [row]);
  }
  const records: WorkRecord[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const group = byKey.get(key)!;
    const days = group.map((r) => r.daysSince).filter((v): v is number => v !== null && !Number.isNaN(v));
    const n = cleanName(group[0].outlet, rules.fillerRegex);
    records.push({
      recKey: key,
      source: group[0].source,
      outletId: group[0].outletId,
      outlet: String(firstNonNull(group.map((r) => r.outlet)) ?? ""),
      segment: firstNonNull(group.map((r) => r.segment)),
      channel: firstNonNull(group.map((r) => r.channel)),
      region: firstNonNull(group.map((r) => r.region)),
      territory: firstNonNull(group.map((r) => r.territory)),
      route: firstNonNull(group.map((r) => r.route)),
      lat: firstNonNull(group.map((r) => r.lat)),
      lon: firstNonNull(group.map((r) => r.lon)),
      principals: [...new Set(group.map((r) => r.principal))].sort().join(", "),
      reps: [...new Set(group.map((r) => r.rep).filter((v): v is string => v !== null && v !== ""))].sort().join(", "),
      sales: group.reduce((s, r) => s + r.sales, 0),
      days: days.length ? Math.min(...days) : null,
      n: cleanName(String(firstNonNull(group.map((r) => r.outlet)) ?? ""), rules.fillerRegex) || n,
      head: "",
    });
  }
  for (const r of records) r.head = r.n.split(" ")[0] ?? "";
  return records;
}

/** Candidate pairs within the search radius, by a uniform grid (cell = radius) over metres projected like the reference implementation. */
function gridPairs(points: { x: number; y: number }[], radius: number): [number, number][] {
  const cell = radius;
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.x / cell)}|${Math.floor(p.y / cell)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const cx = Math.floor(points[i].x / cell);
    const cy = Math.floor(points[i].y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx}|${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
          if (d <= radius) out.push([i, j]);
        }
      }
    }
  }
  return out;
}

function tokens(raw: string): Set<string> {
  return new Set(raw.replace(/\(/g, " ").replace(/\)/g, " ").split(/\s+/).filter(Boolean));
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function gpsPairs(records: WorkRecord[], rules: DedupRules): DedupPair[] {
  const g = records.filter((r) => r.lat !== null && r.lat !== 0 && r.lat >= -5 && r.lat <= 5 && r.lon !== null);
  if (g.length === 0) return [];
  const lat0 = ((g.reduce((s, r) => s + (r.lat as number), 0) / g.length) * Math.PI) / 180;
  const xy = g.map((r) => ({ x: (((r.lon as number) * Math.PI) / 180) * 6371000 * Math.cos(lat0), y: (((r.lat as number) * Math.PI) / 180) * 6371000 }));
  const headFreq = new Map<string, number>();
  for (const r of records) headFreq.set(r.head, (headFreq.get(r.head) ?? 0) + 1);
  const branchWords = new Set(rules.branchWords);
  const out: DedupPair[] = [];
  for (const [i, j] of gridPairs(xy, rules.searchRadiusM)) {
    const a = g[i].n;
    const b = g[j].n;
    if (!a || !b) continue;
    const ha = g[i].head;
    const hb = g[j].head;
    if (similarity(ha, hb) < rules.headSim) continue;
    const sim = similarity(a, b);
    if (sim < rules.minPairSim) continue;
    const d = Math.hypot(xy[i].x - xy[j].x, xy[i].y - xy[j].y);
    const generic = Math.max(headFreq.get(ha) ?? 0, headFreq.get(hb) ?? 0) > rules.commonHeadCount;
    const segA = g[i].segment;
    const segB = g[j].segment;
    const segClash = (segA === "Wholesalers" || segB === "Wholesalers") && segA !== segB;
    const rawA = String(g[i].outlet).toLowerCase();
    const rawB = String(g[j].outlet).toLowerCase();
    const digitsDiffer = !setsEqual(new Set(rawA.match(/\d+/g) ?? []), new Set(rawB.match(/\d+/g) ?? []));
    const ta = tokens(rawA);
    const tb = tokens(rawB);
    const symDiff = [...ta].filter((t) => !tb.has(t)).concat([...tb].filter((t) => !ta.has(t)));
    const pa = [...rawA.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const pb = [...rawB.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const branch =
      symDiff.some((t) => branchWords.has(t)) ||
      symDiff.some((t) => t.length === 1 && /^\p{L}$/u.test(t)) ||
      (pa.length > 0 && pb.length > 0 && JSON.stringify(pa) !== JSON.stringify(pb));
    let confidence: Confidence;
    let reason = "";
    if (digitsDiffer || branch) {
      confidence = "Review";
      reason = "Different branch number / label";
    } else if (a === b && d <= rules.exactNameMaxM && !segClash && (!generic || d <= rules.exactCommonNameMaxM)) {
      confidence = "High";
    } else if (!generic && sim >= rules.highSim && d <= rules.exactNameMaxM && !segClash) {
      confidence = "High";
    } else if (!generic && sim >= rules.mediumSim && similarity(ha, hb) >= rules.mediumSim && d <= rules.mediumMaxM && !segClash) {
      confidence = "Medium";
    } else {
      confidence = "Review";
      reason = segClash ? "Wholesale vs retail record" : generic ? "Common name" : "Too far apart / name differs";
    }
    out.push({ a: g[i].recKey, b: g[j].recKey, nameSim: round(sim, 3), distM: round(d, 1), confidence, reason, method: "GPS + name" });
  }
  return out;
}

export function deduplicate(rows: ExtractRow[], rules: DedupRules = DEFAULT_DEDUP): DedupResult {
  const rec = buildRecords(rows, rules);
  const pairs: DedupPair[] = gpsPairs(rec, rules);

  // Leverage has no GPS: the same cleaned name on the same route is a review candidate only.
  const lv = new Map<string, string[]>();
  for (const r of rec) {
    if (r.source !== "Leverage" || r.n.length === 0 || r.route === null) continue;
    const key = `${r.n}\u0000${r.route}`;
    const list = lv.get(key);
    if (list) list.push(r.recKey);
    else lv.set(key, [r.recKey]);
  }
  for (const ks of lv.values()) {
    for (const k of ks.slice(1)) pairs.push({ a: ks[0], b: k, nameSim: 1, distM: null, confidence: "Review", reason: "No GPS (Leverage): same name, same route", method: "Name + route" });
  }

  // The extract's Match IDs.
  if (rules.useExtractorMatchId) {
    const names = new Map(rec.map((r) => [r.recKey, r.n]));
    const seen = new Set(pairs.map((p) => [p.a, p.b].sort().join("\u0000")));
    const firstPerKey = new Map<string, ExtractRow>();
    for (const row of rows) if (row.matchId !== null && row.matchId !== "" && !firstPerKey.has(row.recKey)) firstPerKey.set(row.recKey, row);
    const byMatch = new Map<string, ExtractRow[]>();
    for (const row of firstPerKey.values()) {
      const list = byMatch.get(row.matchId as string);
      if (list) list.push(row);
      else byMatch.set(row.matchId as string, [row]);
    }
    const extra: DedupPair[] = [];
    for (const matchId of [...byMatch.keys()].sort()) {
      const grp = byMatch.get(matchId)!;
      const ks = grp.map((r) => r.recKey);
      const conf = grp[0].matchConf;
      for (const kb of ks.slice(1)) {
        const key = [ks[0], kb].sort().join("\u0000");
        if (seen.has(key)) {
          if (conf === "High") {
            for (const p of pairs) if ((p.a === ks[0] && p.b === kb) || (p.a === kb && p.b === ks[0])) Object.assign(p, { confidence: "High", reason: "", method: "GPS + name; extractor Match ID" });
          }
          continue;
        }
        extra.push({
          a: ks[0],
          b: kb,
          nameSim: round(similarity(names.get(ks[0]) ?? "", names.get(kb) ?? ""), 3),
          distM: null,
          confidence: conf === "High" ? "High" : "Review",
          reason: conf === "High" ? "" : "Extractor medium-confidence match",
          method: "Extractor Match ID",
        });
      }
    }
    pairs.push(...extra);
  }

  // Union-find over merged pairs.
  let parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const merged = pairs.filter((p) => p.confidence === "High" || p.confidence === "Medium");
  for (const p of merged) parent.set(find(p.a), find(p.b));
  for (const r of rec) r.cluster = find(r.recKey);
  const sizeOf = () => {
    const m = new Map<string, number>();
    for (const r of rec) m.set(r.cluster as string, (m.get(r.cluster as string) ?? 0) + 1);
    return m;
  };
  let sizes = sizeOf();
  if ([...sizes.values()].some((s) => s > rules.maxCluster)) {
    // Chained merges: keep only High links inside oversized clusters.
    const big = new Set([...sizes.entries()].filter(([, s]) => s > rules.maxCluster).map(([c]) => c));
    const clusterOf = new Map(rec.map((r) => [r.recKey, r.cluster as string]));
    parent = new Map();
    for (const p of merged) {
      if (big.has(clusterOf.get(p.a) as string) && p.confidence !== "High") continue;
      parent.set(find(p.a), find(p.b));
    }
    for (const r of rec) r.cluster = find(r.recKey);
    sizes = sizeOf();
  }

  // Master per cluster: source priority, then highest sales, then record order.
  const rank = (r: WorkRecord) => MASTER_SOURCE_PRIORITY[r.source] ?? 9;
  const masterOfCluster = new Map<string, WorkRecord>();
  for (const r of rec) {
    const current = masterOfCluster.get(r.cluster as string);
    if (!current || rank(r) < rank(current) || (rank(r) === rank(current) && r.sales > current.sales)) masterOfCluster.set(r.cluster as string, r);
  }
  const sourcesOfCluster = new Map<string, Set<string>>();
  for (const r of rec) {
    const set = sourcesOfCluster.get(r.cluster as string) ?? new Set<string>();
    set.add(r.source);
    sourcesOfCluster.set(r.cluster as string, set);
  }
  const confOf = new Map<string, Set<string>>();
  const methOf = new Map<string, Set<string>>();
  for (const p of merged) {
    for (const k of [p.a, p.b]) {
      (confOf.get(k) ?? confOf.set(k, new Set()).get(k)!).add(p.confidence);
      const set = methOf.get(k) ?? methOf.set(k, new Set()).get(k)!;
      for (const m of p.method.split(";")) set.add(m.trim());
    }
  }
  const members = new Map<string, WorkRecord[]>();
  for (const r of rec) (members.get(r.cluster as string) ?? members.set(r.cluster as string, []).get(r.cluster as string)!).push(r);
  const clusterConf = new Map<string, string>();
  const clusterMeth = new Map<string, string>();
  for (const [cluster, list] of members) {
    clusterConf.set(cluster, list.every((r) => { const s = confOf.get(r.recKey); return !s || (s.size === 1 && s.has("High")); }) ? "High" : "Medium");
    clusterMeth.set(cluster, [...new Set(list.flatMap((r) => [...(methOf.get(r.recKey) ?? [])]))].sort().join("; "));
  }
  const byKey = new Map(rec.map((r) => [r.recKey, r]));
  const records: DedupRecord[] = rec.map((r) => {
    const cluster = r.cluster as string;
    const master = masterOfCluster.get(cluster)!;
    const size = sizes.get(cluster) ?? 1;
    const isMaster = r.recKey === master.recKey;
    const sourceCount = sourcesOfCluster.get(cluster)?.size ?? 1;
    const m = byKey.get(master.recKey)!;
    const metres =
      isMaster || r.lat === null || r.lon === null || m.lat === null || m.lon === null
        ? null
        : Math.hypot((r.lon - m.lon) * 111320 * Math.cos((-1 * Math.PI) / 180), (r.lat - m.lat) * 110540);
    return {
      ...r,
      cluster,
      clusterSize: size,
      masterId: master.recKey,
      isMaster,
      matchType: size === 1 ? "Unique" : sourceCount > 1 ? "Across systems" : "Within system",
      confidence: size > 1 ? (clusterConf.get(cluster) ?? "") : "",
      method: size > 1 ? (clusterMeth.get(cluster) ?? "") : "",
      metresFromMaster: metres,
      simToMaster: isMaster ? null : round(similarity(r.n, m.n), 2),
    };
  });
  return { records, pairs };
}

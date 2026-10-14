// Cross-system outlet matching for the Active Outlet universe.
//
// Pine, Leverage, EABL DMS and Upfield DataEdge share no outlet id, so one shop served through two systems is two rows. This finds those
// pairs from what the systems do share: the name, the place and the GPS point, and gives each group of matched outlets one match id so
// the extract can flag them. Nothing is merged or removed: every system's row stays, flagged.
//
// Two outlets in different systems match when they are close and their names agree on the words that tell shops apart:
//  - the distinctive words of a name are what is left after dropping filler (shop, stores, ltd ...), the outlet's own place words and
//    common first names, weighted by how rare they are across all outlets;
//  - High: within 100 m and the distinctive words are the same, or the names are the same; within 150 m and the names are the same;
//  - Medium: within 300 m and the distinctive words are the same, within 150 m and most of their weight is shared, or within 100 m and
//    one name holds two or more distinctive words that all appear in the other.
// A group holds at most one outlet per system, so a chain of near neighbours cannot snowball into one big group.

export const MATCH_HIGH = "High";
export const MATCH_MEDIUM = "Medium";
export type MatchConfidence = typeof MATCH_HIGH | typeof MATCH_MEDIUM;

export interface MatchInput {
  /** Unique per outlet: source + outlet key. */
  id: string;
  source: string;
  name: string;
  location: string;
  region: string;
  territory: string;
  route: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface MatchGroup {
  matchId: string;
  confidence: MatchConfidence;
  /** The sources in the group, in alphabetical order. */
  sources: string[];
}

const FILLER = new Set([
  "shop", "shops", "store", "stores", "supermarket", "supermarkets", "super", "market", "markets", "mart", "minimart", "mini", "wholesalers", "wholesaler",
  "wholesale", "ltd", "limited", "enterprises", "enterprise", "general", "gen", "retail", "retailers", "retailer", "traders", "trader", "trading", "agencies",
  "agency", "distributors", "distributor", "co", "company", "and", "the", "of", "kiosk", "butchery", "cosmetics", "chemist", "pharmacy", "hardware", "nairobi",
  "kenya", "ke", "no", "bar", "restaurant", "hotel", "lodge", "cafe", "centre", "center", "business", "investments", "investment", "ent", "stockist", "dealers",
  "dealer", "outlet", "depot",
]);

// Common first names and kin words: they name thousands of different shops ("Mama Mary Shop") so they do not tell two shops apart.
const COMMON_NAMES = new Set([
  "mama", "baba", "mum", "dad", "mzee", "madam", "mr", "mrs", "mary", "john", "peter", "jane", "grace", "mercy", "faith", "joyce", "agnes", "alice", "ann", "anne",
  "james", "paul", "david", "esther", "lucy", "sarah", "rose", "jackline", "jacqueline", "caroline", "susan", "nancy", "beatrice", "elizabeth", "mwangi", "kamau",
  "wanjiku", "njeri", "otieno", "ochieng", "achieng", "akinyi", "wa", "kwa", "wanjiru", "muthoni", "nyambura", "wambui", "waweru", "karanja", "mutua", "kioko", "kimani",
]);

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/&/g, " and ").replace(/['`’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string | null | undefined): string[] {
  return normalizeName(value).split(" ").filter(Boolean);
}

/** The words of a name without filler; the whole name when nothing else is left. */
function coreTokens(value: string): string[] {
  const all = tokens(value);
  const kept = all.filter((word) => !FILLER.has(word));
  return kept.length > 0 ? kept : all;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatch = new Array<boolean>(la).fill(false);
  const bMatch = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = true;
        bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Metres between two points (haversine). */
export function distanceMetres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Two words are the same word when equal, or both long and nearly equal ("Kairo" / "Kairu" are not; "Supermarket" / "Supermarkt" are). */
function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && jaroWinkler(a, b) >= 0.93;
}

interface Prepared {
  input: MatchInput;
  normalized: string;
  distinctive: string[];
}

export interface NamePair {
  /** The two names are the same once case, punctuation and filler are ignored. */
  sameName: boolean;
  /** The distinctive words of the shorter name all appear in the other and carry most of the longer name's weight. */
  sameDistinctive: boolean;
  /** The shorter name has two or more distinctive words and all of them appear in the other name. */
  contained: boolean;
  /** Share of the distinctive weight that the two names have in common, 0 to 1. */
  shared: number;
  /** Both names come down to the same single, very common word ( "Hope", "Blessed" ): only a match when the outlets are nearly on top of each other. */
  commonWord: boolean;
  /** At least one rare word is shared. */
  sharesRareWord: boolean;
}

const RARE_WORD_WEIGHT = 4;
const COMMON_WORD_WEIGHT = 6; // a word in more than about 170 of 67,000 outlet names
const COMMON_WORD_METRES = 40;

export function comparePrepared(a: Prepared, b: Prepared, weight: (word: string) => number): NamePair {
  const wa0 = a.distinctive;
  const wb0 = b.distinctive;
  const sameName = a.normalized !== "" && (a.normalized === b.normalized || (a.distinctive.length > 0 && a.distinctive.join(" ") === b.distinctive.join(" ")));
  const commonWord = wa0.length === 1 && wb0.length === 1 && weight(wa0[0]) < COMMON_WORD_WEIGHT;
  const wa = a.distinctive;
  const wb = b.distinctive;
  if (wa.length === 0 || wb.length === 0) return { sameName, sameDistinctive: false, contained: false, commonWord, shared: 0, sharesRareWord: false };
  const used = new Set<number>();
  let sharedWeight = 0;
  let sharedCount = 0;
  let sharesRareWord = false;
  for (const word of wa) {
    const at = wb.findIndex((other, index) => !used.has(index) && wordMatch(word, other));
    if (at < 0) continue;
    used.add(at);
    sharedCount++;
    sharedWeight += weight(word);
    if (weight(word) >= RARE_WORD_WEIGHT) sharesRareWord = true;
  }
  const total = (words: string[]) => words.reduce((sum, word) => sum + weight(word), 0);
  const shared = sharedWeight / Math.max(total(wa), total(wb), 1e-9);
  const allOfShorter = sharedCount === Math.min(wa.length, wb.length) && sharesRareWord;
  return { sameName, sameDistinctive: allOfShorter && shared >= 0.6, contained: allOfShorter && Math.min(wa.length, wb.length) >= 2, commonWord, shared, sharesRareWord };
}

export function matchTier(pair: NamePair, metres: number): MatchConfidence | null {
  if (pair.commonWord && metres > COMMON_WORD_METRES) return null;
  if (pair.sameName && metres <= 150) return MATCH_HIGH;
  if (pair.sameDistinctive && metres <= 100) return MATCH_HIGH;
  if (pair.sameDistinctive && metres <= 300) return MATCH_MEDIUM;
  if (pair.sharesRareWord && pair.shared >= 0.7 && metres <= 150) return MATCH_MEDIUM;
  if (pair.contained && metres <= 100) return MATCH_MEDIUM;
  if (pair.sameName && metres <= 300) return MATCH_MEDIUM;
  return null;
}

const CELL_DEGREES = 0.002; // about 220 m; the 3 x 3 neighbourhood covers the 300 m reach
const MAX_METRES = 300;

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

function prepare(outlets: MatchInput[]): { prepared: Prepared[]; weight: (word: string) => number } {
  // Word statistics over every outlet: how rare each word is, and which words are places.
  const documentFrequency = new Map<string, number>();
  const places = new Set<string>();
  for (const outlet of outlets) {
    for (const word of new Set(coreTokens(outlet.name))) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    for (const field of [outlet.territory, outlet.location, outlet.region, outlet.route]) for (const word of tokens(field)) places.add(word);
  }
  const weight = (word: string) => Math.log(1 + outlets.length / (documentFrequency.get(word) ?? 1));

  const prepared: Prepared[] = outlets.map((input) => {
    const own = new Set([...tokens(input.territory), ...tokens(input.location), ...tokens(input.region), ...tokens(input.route)]);
    const core = coreTokens(input.name);
    const distinctive = core.filter((word) => word.length > 1 && !own.has(word) && !places.has(word) && !COMMON_NAMES.has(word));
    return { input, normalized: core.join(" "), distinctive: distinctive.length > 0 ? distinctive : core.filter((word) => word.length > 1 && !COMMON_NAMES.has(word)) };
  });
  return { prepared, weight };
}

/** Why two outlets do or do not match, for diagnosing a pair: their distinctive words and the comparison. */
export function explainMatch(outlets: MatchInput[], idA: string, idB: string): { a: string[]; b: string[]; pair: NamePair; metres: number | null; confidence: MatchConfidence | null } | null {
  const { prepared, weight } = prepare(outlets);
  const a = prepared.find((item) => item.input.id === idA);
  const b = prepared.find((item) => item.input.id === idB);
  if (!a || !b) return null;
  const pair = comparePrepared(a, b, weight);
  const metres = a.input.latitude === null || a.input.longitude === null || b.input.latitude === null || b.input.longitude === null ? null : distanceMetres(a.input.latitude, a.input.longitude, b.input.latitude, b.input.longitude);
  return { a: a.distinctive, b: b.distinctive, pair, metres, confidence: metres === null ? null : matchTier(pair, metres) };
}

/** Groups outlets that are the same shop in different systems. Outlets that match nothing are not in the result. */
export function matchOutlets(outlets: MatchInput[]): Map<string, MatchGroup> {
  const { prepared, weight } = prepare(outlets);

  const grid = new Map<string, number[]>();
  prepared.forEach((item, index) => {
    const { latitude, longitude } = item.input;
    if (latitude === null || longitude === null) return;
    const key = `${Math.floor(latitude / CELL_DEGREES)}|${Math.floor(longitude / CELL_DEGREES)}`;
    const cell = grid.get(key);
    if (cell) cell.push(index);
    else grid.set(key, [index]);
  });

  interface Candidate {
    a: number;
    b: number;
    confidence: MatchConfidence;
    metres: number;
    shared: number;
  }
  const candidates: Candidate[] = [];
  prepared.forEach((item, index) => {
    const { latitude, longitude } = item.input;
    if (latitude === null || longitude === null) return;
    const gx = Math.floor(latitude / CELL_DEGREES);
    const gy = Math.floor(longitude / CELL_DEGREES);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${gx + dx}|${gy + dy}`) ?? []) {
          if (other <= index) continue;
          const peer = prepared[other];
          if (peer.input.source === item.input.source) continue;
          const metres = distanceMetres(latitude, longitude, peer.input.latitude as number, peer.input.longitude as number);
          if (metres > MAX_METRES) continue;
          const pair = comparePrepared(item, peer, weight);
          const confidence = matchTier(pair, metres);
          if (confidence) candidates.push({ a: index, b: other, confidence, metres, shared: pair.shared });
        }
      }
    }
  });

  // Best pairs first, then join groups that stay at one outlet per system.
  candidates.sort((x, y) => (x.confidence === y.confidence ? y.shared - x.shared || x.metres - y.metres : x.confidence === MATCH_HIGH ? -1 : 1));
  const parent = prepared.map((_, index) => index);
  const members = prepared.map((_, index) => [index]);
  const confidence = prepared.map(() => MATCH_HIGH as MatchConfidence);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const candidate of candidates) {
    const ra = find(candidate.a);
    const rb = find(candidate.b);
    if (ra === rb) continue;
    const sources = new Set(members[ra].map((i) => prepared[i].input.source));
    if (members[rb].some((i) => sources.has(prepared[i].input.source))) continue;
    parent[rb] = ra;
    members[ra].push(...members[rb]);
    if (candidate.confidence === MATCH_MEDIUM || confidence[rb] === MATCH_MEDIUM) confidence[ra] = MATCH_MEDIUM;
  }

  const groups = new Map<string, MatchGroup>();
  prepared.forEach((_, index) => {
    if (find(index) !== index || members[index].length < 2) return;
    const ids = members[index].map((i) => prepared[i].input.id).sort();
    const group: MatchGroup = {
      matchId: `M${hash(ids.join("|"))}`,
      confidence: confidence[index],
      sources: Array.from(new Set(members[index].map((i) => prepared[i].input.source))).sort(),
    };
    for (const id of ids) groups.set(id, group);
  });
  return groups;
}

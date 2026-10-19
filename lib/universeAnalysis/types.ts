// Universe analysis: the row shapes. An ExtractRow is one outlet x principal row of the Active Outlets extract (the principal view), with the strike
// columns for the month being analysed. A FactRow is that row after de-duplication and enrichment.

export interface ExtractRow {
  /** "Pine" | "EABL DMS" | "Upfield DataEdge" | "Leverage" (the extract's source label). */
  source: string;
  outletId: string;
  outlet: string;
  principal: string;
  /** Classification2: "Primary Sales" (direct) or "Secondary Sales" (distributor). */
  routeClass: string;
  channel: string;
  segment: string;
  region: string;
  territory: string;
  route: string | null;
  rep: string | null;
  lat: number | null;
  lon: number | null;
  lastPurchase: string | null;
  daysSince: number | null;
  sales: number;
  avgSales: number | null;
  tx: number;
  buyingSince: string | null;
  monthsBuying: number | null;
  tenure: string | null;
  periods3: number | null;
  consistency: string | null;
  tier: string | null;
  combinedAvg: number | null;
  bought30: string | null;
  matchId: string | null;
  matchConf: string | null;
  teamLeader: string | null;
  repRegion: string | null;
  repSubregion: string | null;
  /** Calls and productive calls in the analysed period; null where the source records no outcome (Leverage). */
  calls: number | null;
  productive: number | null;
  strike: number | null;
  /** The same over the trailing three months ending at the analysed month (used for the "fix strike rate" worklist only). */
  callsRecent: number | null;
  productiveRecent: number | null;
  /** The principal's own strike rate over all its customers (percent), as the extract delivers it. */
  principalStrike: number | null;
  /** Unique across systems: "PINE-123". */
  recKey: string;
  isDirect: boolean;
}

export type CoverageRoute = "Direct only" | "Direct + Distributor" | "Distributor only";

export interface FactRow extends ExtractRow {
  masterId: string;
  regionClean: string;
  avgInvoiceUnique: number | null;
  tierCorrected: string;
  monthlyRunRate: number | null;
  callsWithOutcome: number;
  productiveCalls: number;
  unproductiveCalls: number;
  unproductiveValue: number;
  /** Calls with an outcome, productive calls and strike rate (percent) over the trailing three months. */
  recentCalls: number;
  recentProductive: number;
  recentStrike: number | null;
  lapsing: boolean;
  consistent: boolean;
  newOutlet: boolean;
  coverageRoute: CoverageRoute;
  recencyBand: string;
  strikeBand: string;
  uniqueOutletCount: 0 | 1;
  outletPrincipalCount: 0 | 1;
}

export type Confidence = "High" | "Medium" | "Review";

export interface DedupPair {
  a: string;
  b: string;
  nameSim: number;
  distM: number | null;
  confidence: Confidence;
  reason: string;
  method: string;
}

export interface DedupRecord {
  recKey: string;
  source: string;
  outletId: string;
  outlet: string;
  segment: string | null;
  channel: string | null;
  region: string | null;
  territory: string | null;
  route: string | null;
  lat: number | null;
  lon: number | null;
  principals: string;
  reps: string;
  sales: number;
  days: number | null;
  /** Cleaned name used for matching, and its first word. */
  n: string;
  head: string;
  cluster: string;
  clusterSize: number;
  masterId: string;
  isMaster: boolean;
  matchType: "Unique" | "Across systems" | "Within system";
  confidence: string;
  method: string;
  metresFromMaster: number | null;
  simToMaster: number | null;
}

export interface DedupResult {
  records: DedupRecord[];
  pairs: DedupPair[];
}

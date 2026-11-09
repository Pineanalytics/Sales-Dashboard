// Universe analysis: constants and tunable assumptions, in one place. A port of the outlet-analytics package's config (the logic behind the
// "Active Outlets per Principal" workbook). Everything a business user may want to change lives here.

export const PRIMARY = "Primary Sales"; // sold by Pinefrost reps (direct)
export const SECONDARY = "Secondary Sales"; // sold by Mars distributor reps

export const SOURCE_PREFIX: Record<string, string> = { Pine: "PINE", "Upfield DataEdge": "UPF", Leverage: "LEV", "EABL DMS": "EABL" };
export const MASTER_SOURCE_PRIORITY: Record<string, number> = { Pine: 0, "Upfield DataEdge": 1, "EABL DMS": 2, Leverage: 3 };
export const CLEAN_REGIONS = ["Nairobi", "Eastern", "Central", "Nyeri", "Nyahururu"];
export const REGION_ALIASES: Record<string, string> = { "Upper Mountain (SA)": "Nyeri" };

// Tier bands, applied to the TRUE average invoice per unique outlet: [limit, label, inclusive].
export const RETAIL_TIERS: [number, string, boolean][] = [
  [500, "500 & Below", true],
  [1000, "501 - 1,000", false],
  [5000, "1,001 - 5,000", false],
  [10000, "5,001 - 9,999", false],
];
export const RETAIL_TOP = "10,000 & Above";
export const WHOLESALE_TIERS: [number, string, boolean][] = [
  [5000, "5,000 & Below", true],
  [10000, "5,001 - 10,000", true],
  [20000, "10,001 - 20,000", true],
  [50000, "20,001 - 50,000", true],
];
export const WHOLESALE_TOP = "Above 50,000";

// (lower, upper] bands, like pandas.cut with right-inclusive bins.
export const RECENCY_EDGES = [-1, 7, 14, 30, 60, 89];
export const RECENCY_LABELS = ["0-7 days", "8-14 days", "15-30 days", "31-60 days", "61-89 days"];
export const STRIKE_EDGES = [-1, 49.99, 74.99, 99.99, 100];
export const STRIKE_LABELS = ["<50%", "50-74%", "75-99%", "100%"];

export interface DedupRules {
  searchRadiusM: number;
  exactNameMaxM: number; // identical cleaned names within this distance -> High
  exactCommonNameMaxM: number; // ...tighter when the first word is very common
  highSim: number; // name similarity for High within exactNameMaxM
  mediumSim: number; // typo-level similarity for Medium
  mediumMaxM: number;
  sameNameMaxM: number; // identical cleaned names within this distance (not a common name, no wholesale / retail clash) -> Medium
  nearNameMaxM: number; // names at highSim or closer within this distance -> Medium
  headSim: number; // first-word similarity gate
  minPairSim: number; // below this, not even a review candidate
  commonHeadCount: number; // a first word used by more than N outlets is "common"
  maxCluster: number; // guard against chained merges
  useExtractorMatchId: boolean;
  branchWords: string[];
  fillerRegex: string;
}

export const DEFAULT_DEDUP: DedupRules = {
  searchRadiusM: 60,
  exactNameMaxM: 30,
  exactCommonNameMaxM: 15,
  highSim: 0.9,
  mediumSim: 0.85,
  mediumMaxM: 25,
  sameNameMaxM: 60,
  nearNameMaxM: 45,
  headSim: 0.8,
  minPairSim: 0.7,
  commonHeadCount: 40,
  maxCluster: 4,
  useExtractorMatchId: true,
  branchWords: ["upper", "lower", "main", "hyper", "annex", "branch", "east", "west", "north", "south", "new", "old", "phase", "stage"],
  fillerRegex:
    "\\b(shop|shops|store|stores|ltd|limited|general|gen|kiosk|the|and|co|company|enterprises?|ent|traders?|trading|supermarket|super|market|minimart|mini|mart|wholesalers?|wholesale|w s|ws|duka|dukas|retail|retailers?|outlet|centre|center|no|one)\\b",
};

/** The rules as the Active Outlets analysis workbook applied them: identical names only within exactNameMaxM, nothing looser. Kept to check a change to the defaults against it. */
export const STRICT_DEDUP: DedupRules = { ...DEFAULT_DEDUP, sameNameMaxM: 0, nearNameMaxM: 0 };

/** Editable capture rates used for opportunity sizing (shown in the UI as what-ifs; the defaults never change per user). */
export interface Assumptions {
  distributorToDirect: number;
  crossSell: number;
  frequencyRecovery: number;
  lapsingWinback: number;
  unproductiveCallConversion: number;
  monthsToAnnualise: number;
  minSegmentOutletsForBenchmark: number;
  minPoolForCrossSell: number;
  crossSellPrincipals: string[];
  nairobiPrincipals: string[];
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  distributorToDirect: 0.1,
  crossSell: 0.15,
  frequencyRecovery: 0.25,
  lapsingWinback: 0.4,
  unproductiveCallConversion: 0.25,
  monthsToAnnualise: 12,
  minSegmentOutletsForBenchmark: 30,
  minPoolForCrossSell: 25,
  crossSellPrincipals: ["Suntory-Nairobi", "Weetabix-Nairobi", "Upfield-Nairobi", "Tropikal-Nairobi"],
  nairobiPrincipals: ["Suntory-Nairobi", "Weetabix-Nairobi", "Upfield-Nairobi", "Tropikal-Nairobi", "Mars-Nairobi", "EFL-Nairobi", "Unilever-Nairobi", "Bic-Nairobi", "Energia-Nairobi", "Promasidor-Nairobi"],
};

export interface RepFlags {
  thinRouteOutlets: number;
  lowStrike: number;
  highLapsing: number;
  lowConsistency: number;
  nonFieldKeywords: string[];
}

export const DEFAULT_REP_FLAGS: RepFlags = {
  thinRouteOutlets: 40,
  lowStrike: 0.75,
  highLapsing: 0.4,
  lowConsistency: 0.45,
  nonFieldKeywords: ["counter", "key account", "van ", "office"],
};

// The "fix strike rate" worklist looks at the trailing three months ending at the analysed month (one month alone is too thin to flag an outlet):
// called at least this many times (customer-months, summed over reps) and productive on fewer than the threshold share of them.
export const LOW_STRIKE_WINDOW_MONTHS = 3;
export const LOW_STRIKE_MIN_CALLS = 2;
export const LOW_STRIKE_THRESHOLD = 50.0;
export const TARGET_LIST_SIZE = 300;

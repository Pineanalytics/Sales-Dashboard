// Shared shapes and constants of the outlet cleanup (the Cleanup tab of Active Outlets). Pure: safe to import from the browser.
import type { OutletSource } from "@/lib/outletUniverse/normalize";

/** The identification fields a team leader verifies. A field they have updated or confirmed is locked for them afterwards. */
export const IDENTIFICATION_FIELDS = ["region", "territory", "channel", "customerType", "contactName", "contactPhone"] as const;
export type IdentificationField = (typeof IDENTIFICATION_FIELDS)[number];

/** Locks also cover the other things a team leader can settle on an outlet. */
export type LockableField = IdentificationField | "geo" | "reps";

export const FIELD_LABELS: Record<LockableField, string> = {
  region: "Region",
  territory: "Territory",
  channel: "Channel",
  customerType: "Customer type",
  contactName: "Contact name",
  contactPhone: "Contact phone",
  geo: "GPS location",
  reps: "Selling rep",
};

export type EntryStatus = "REVIEWED" | "VALIDATED" | "APPLIED" | "REJECTED";
/** What the queue shows for an outlet: no entry yet, or the entry's status. */
export type ReviewState = "UNREVIEWED" | EntryStatus | "DISOWNED";

export interface CleanupActor {
  email: string;
  role: string;
  /** Can validate, apply, reopen locked fields and set targets. */
  isAdmin: boolean;
  /** Can review outlets (a team leader, a supervisor, or an admin). */
  canReview: boolean;
  /** Can see every team's progress and the leaderboard. */
  canSeeAll: boolean;
  /** Names of the team leaders (TeamLeader.name) whose outlets this person works on; null means all of them (an admin). */
  teamLeaders: string[] | null;
  /** The team leader's own name (a team leader), or the supervisor's name. */
  displayName: string | null;
}

export interface OutletRepRow {
  principal: string;
  rep: string | null;
  repCode: string | null;
  teamLeader: string | null;
  /** The team leader may validate or change this row's rep (it is theirs, or they are an admin / supervisor of that team). */
  editable: boolean;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RepDecision {
  principal: string;
  rep: string;
  repCode: string | null;
  previousRep: string | null;
  action: "CONFIRMED" | "CHANGED";
  /** The route the rep visits the outlet on, and the days of the week, as the team leader validated them. */
  routeName?: string | null;
  visitDays?: Weekday[];
}

/** What the visit history says about an outlet's route days: where the suggestion in the form comes from. */
export interface VisitSuggestion {
  /** Where the visits come from, e.g. "Pine call timestamps". */
  basis: string;
  windowDays: number;
  /** Distinct days the outlet was visited in the window (by the rep of this row when they have visits, else by anyone). */
  visitDays: number;
  weeksVisited: number;
  weeksInWindow: number;
  visitsPerMonth: number;
  cadence: "Weekly or more" | "Fortnightly" | "Monthly" | "Occasional" | "No visits on record";
  weekdayCounts: Record<Weekday, number>;
  suggestedDays: Weekday[];
  /** Reps who visited, most visits first. */
  reps: { code: string | null; name: string; visits: number }[];
  /** The rep with the most visits when that is not the rep on this row and is on the principal's rep list. */
  suggestedRep: { code: string; name: string } | null;
  /** A route and days the source system already plans (Leverage and Upfield journey plans, Pine's July-August plan). */
  planned: { route: string | null; days: Weekday[] } | null;
}

export interface RowRouting {
  routeName: string | null;
  visitDays: Weekday[];
  suggestion: VisitSuggestion;
  /** The routes this row may be put on: the team leader's named routes and the routes already on their outlets. */
  routeOptions: string[];
}

/** Whether the outlet is still buying: Active, or dormant (Lapsed, Lost, or no purchase on record). */
export type OutletActivity = "ACTIVE" | "LAPSED" | "LOST" | "NO_PURCHASE";

export interface QueueRow {
  source: OutletSource;
  outletKey: string;
  outletName: string;
  principals: string;
  region: string;
  territory: string;
  channel: string;
  customerType: string;
  teamLeaders: string;
  /** The selling reps on this person's teams for the outlet, across principals. */
  reps: string;
  hasGeo: boolean;
  /** Outlets in this outlet's shop (1 = unique); more than 1 marks a duplicate the universe cleanup merged. */
  shopSize: number;
  state: ReviewState;
  lastPurchaseDate: string | null;
  activity: OutletActivity;
  daysSince: number | null;
}

export const QUEUE_PAGE_SIZE = 25;

export interface CleanupOptions {
  regions: string[];
  territories: string[];
  channels: string[];
  customerTypes: string[];
}

/** The roster reps and territories a person can narrow their outlet list to; each list is cut down by the other's current choice. */
export interface QueueFilterOptions {
  reps: string[];
  territories: string[];
  /** Outlets here whose selling rep is not on the person's roster; the filter offers them as their own choice. */
  offRoster: number;
}

export interface RepOption {
  code: string;
  name: string;
  teamLeader: string | null;
}

export interface DuplicateCandidate {
  source: OutletSource;
  outletKey: string;
  outletName: string;
  principals: string;
  territory: string;
  distanceM: number | null;
  /** Already in the same shop (merged by the universe cleanup). */
  inSameShop: boolean;
  /** The team leader's earlier call on this pair, if any. */
  decision: "MERGE" | "NOT_DUPLICATE" | null;
}

export interface OutletDetail {
  source: OutletSource;
  outletKey: string;
  outletName: string;
  state: ReviewState;
  /** The universe's values, and what the team leader has verified on top of them. */
  current: Record<IdentificationField, string>;
  verified: Partial<Record<IdentificationField, string>>;
  geo: { latitude: number | null; longitude: number | null; taggedAt: string | null; taggedBy: string | null; accuracyM: number | null; missing: boolean };
  reps: OutletRepRow[];
  repDecisions: RepDecision[];
  /** Per principal row: the current route and days, the suggestion from the visit history, and the routes to choose from. */
  routing: Record<string, RowRouting>;
  /** The places the outlets of this outlet's team leader sit in, for naming a route after its major locations. */
  routeLocations: string[];
  lockedFields: LockableField[];
  confirmedAsIs: boolean;
  shop: { shopId: string | null; shopSize: number; confidence: string | null };
  /** Whether the outlet is still buying, and when it last bought. */
  activity: { activity: OutletActivity; lastPurchaseDate: string | null; daysSince: number | null };
  duplicates: DuplicateCandidate[];
  openStatus: { status: string; candidates: { teamLeader: string; response: string }[] } | null;
  /** What this person may do on this outlet right now. */
  canEdit: boolean;
  canUnlock: boolean;
  options: CleanupOptions;
  repOptions: Record<string, RepOption[]>;
  teamLeaderOptions: string[];
  history: { at: string; actor: string; action: string }[];
}

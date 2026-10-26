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

export interface RepDecision {
  principal: string;
  rep: string;
  repCode: string | null;
  previousRep: string | null;
  action: "CONFIRMED" | "CHANGED";
}

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
  hasGeo: boolean;
  shopSize: number;
  state: ReviewState;
}

export const QUEUE_PAGE_SIZE = 25;

export interface CleanupOptions {
  regions: string[];
  territories: string[];
  channels: string[];
  customerTypes: string[];
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
  lockedFields: LockableField[];
  confirmedAsIs: boolean;
  shop: { shopId: string | null; shopSize: number; confidence: string | null };
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

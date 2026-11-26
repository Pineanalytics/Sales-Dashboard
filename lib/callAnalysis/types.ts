// Call analysis (Coverage & Productivity): timestamps, coverage and productivity of the reps' calls, from the four systems that
// record them, over any run of days. Types and labels shared by the server and the page.

export type CallSource = "pine" | "eabl" | "upfield" | "unilever";

export const CALL_SOURCES: readonly CallSource[] = ["pine", "eabl", "upfield", "unilever"];

export const CALL_SOURCE_LABELS: Record<CallSource, string> = {
  pine: "Pine SalesEdge",
  eabl: "EABL DMS",
  upfield: "Upfield DataEdge",
  unilever: "Unilever Leverage",
};

export type CallGroupBy = "day" | "week" | "month" | "rep" | "principal" | "teamLeader" | "source" | "repDay";

export const CALL_GROUP_OPTIONS: readonly { key: CallGroupBy; label: string }[] = [
  { key: "rep", label: "Rep" },
  { key: "principal", label: "Principal" },
  { key: "teamLeader", label: "Team leader" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "source", label: "System" },
  { key: "repDay", label: "Rep by day" },
];

export type CallRoleFilter = "all" | "Primary Sales" | "Secondary Sales";

/** The longest run of days one request may cover. */
export const CALL_ANALYSIS_MAX_DAYS = 366;

/** The team leader shown for a rep the roster gives none. */
export const NO_TEAM_LEADER = "General";

/** One rep's one day in one system: everything the report adds up. */
export interface RepDayFact {
  source: CallSource;
  date: string; // YYYY-MM-DD, Nairobi calendar day
  repKey: string; // unique across systems
  repName: string;
  principalKey: string;
  principal: string;
  teamLeader: string;
  role: string; // "Primary Sales" | "Secondary Sales"
  /** First and last activity, minutes after midnight (Nairobi). Null when the system recorded no time. */
  firstMinutes: number | null;
  lastMinutes: number | null;
  /** Outlets called on that day. Null where the system holds only invoices, so a call without a sale is never seen (Leverage). */
  calls: number | null;
  /** Outlets with a sale or order that day. */
  productive: number;
  /** Outlet ids called on (invoiced, where calls are null) and, of those, the ones that bought. */
  outlets: string[];
  productiveOutlets: string[];
  /** Product lines on the productive calls, and how many of those calls have lines recorded. */
  lines: number;
  linesCalls: number;
  /** Sales value (KES) on the productive calls. */
  value: number;
  /** Cases on the productive calls, and how many of those calls have cases worked out. */
  cases: number;
  casesCalls: number;
  /** Minutes between consecutive calls: their sum and how many there were (Pine only). */
  intervalSum: number;
  intervalCount: number;
}

export interface CallMetrics {
  reps: number;
  repDays: number;
  /** Average first and last activity (minutes after midnight) and hours between them, over working days where there are any. */
  avgStartMinutes: number | null;
  avgCloseMinutes: number | null;
  avgHours: number | null;
  /** Share of timed rep-days whose first activity was after 9:30 AM. */
  lateStartPct: number | null;
  avgIntervalMins: number | null;
  calls: number | null;
  callsPerRepDay: number | null;
  productive: number;
  productivePerRepDay: number | null;
  /** Productive calls divided by calls, over the systems that record every call. */
  strikeRatePct: number | null;
  /** Different outlets called on, and different outlets that bought: counted once per month and averaged over the months. */
  coverage: number;
  productiveCoverage: number;
  /** Lines per productive call, and the share of productive calls that have lines recorded (0 to 100). */
  lppc: number | null;
  lppcDataPct: number | null;
  value: number;
  dropSizeValue: number | null;
  cases: number | null;
  dropSizeCases: number | null;
  casesDataPct: number | null;
}

export interface CallRow extends CallMetrics {
  key: string;
  label: string;
  /** Context under the label: a rep's principal and team leader, or the date of a rep-day row. */
  detail: string | null;
}

export interface CallOption {
  key: string;
  label: string;
}

export interface CallAnalysisResult {
  from: string;
  to: string;
  groupBy: CallGroupBy;
  total: CallMetrics;
  rows: CallRow[];
  /** One row per day, for the trend chart. */
  trend: CallRow[];
  /** Choices for the filters, from everything in the date range, principal and system selected. */
  options: { reps: CallOption[]; teamLeaders: string[]; principals: CallOption[] };
  /** The first and last day each system holds, whatever the filters. */
  availability: { source: CallSource; first: string | null; last: string | null }[];
}

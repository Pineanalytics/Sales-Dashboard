// The pure part of the cleanup tracker (lib/outletCleanup/tracker.ts): the date range and turning the database's counts into the report.

export interface TrackerDay {
  date: string;
  /** Distinct outlets anyone worked on that day. */
  outlets: number;
  /** Distinct outlets a sales rep worked on. */
  repOutlets: number;
  geoTags: number;
  validated: number;
  sentBack: number;
}

export interface TrackerPerson {
  actor: string;
  role: string;
  outlets: number;
  actions: number;
  geoTags: number;
  days: number;
  lastAt: string;
}

export interface TrackerTeamStatus {
  teamLeader: string;
  submitted: number;
  reviewed: number;
  validated: number;
  applied: number;
  sentBack: number;
  geoTagged: number;
}

export interface TrackerReport {
  from: string;
  to: string;
  days: TrackerDay[];
  people: TrackerPerson[];
  teams: TrackerTeamStatus[];
  totals: { outlets: number; repOutlets: number; geoTags: number; validated: number; sentBack: number; people: number; activeDays: number };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

/** Nairobi's calendar date today. */
export const nairobiToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });

/** The days asked for: from and to (YYYY-MM-DD) as given, the first of this month to today otherwise; at most a year, never reversed. */
export function trackerRange(fromText: string | null, toText: string | null, today = nairobiToday()): { from: string; to: string } {
  let to = toText && DAY.test(toText) ? toText : today;
  if (to > today) to = today;
  let from = fromText && DAY.test(fromText) ? fromText : `${to.slice(0, 7)}-01`;
  if (from > to) from = to;
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > MAX_DAYS) from = new Date(Date.parse(`${to}T00:00:00Z`) - MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export interface RawDay { date: string; outlets: bigint; rep_outlets: bigint; geo_tags: bigint; validated: bigint; sent_back: bigint }
export interface RawPerson { actor: string; role: string; outlets: bigint; actions: bigint; geo_tags: bigint; days: bigint; last_at: Date }
export interface RawTeam { teamLeader: string; submitted: bigint; reviewed: bigint; validated: bigint; applied: bigint; sent_back: bigint; geo_tagged: bigint }

/** Turns the database's counts into the report (pure, so it is tested without a database). */
export function shapeTracker(range: { from: string; to: string }, raw: { days: RawDay[]; people: RawPerson[]; teams: RawTeam[]; distinct: { outlets: bigint; rep_outlets: bigint } }): TrackerReport {
  const days = raw.days
    .map((d) => ({ date: d.date, outlets: n(d.outlets), repOutlets: n(d.rep_outlets), geoTags: n(d.geo_tags), validated: n(d.validated), sentBack: n(d.sent_back) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const people = raw.people
    .map((p) => ({ actor: p.actor, role: p.role, outlets: n(p.outlets), actions: n(p.actions), geoTags: n(p.geo_tags), days: n(p.days), lastAt: new Date(p.last_at).toISOString() }))
    .sort((a, b) => b.outlets - a.outlets || a.actor.localeCompare(b.actor));
  const teams = raw.teams
    .map((t) => ({ teamLeader: t.teamLeader, submitted: n(t.submitted), reviewed: n(t.reviewed), validated: n(t.validated), applied: n(t.applied), sentBack: n(t.sent_back), geoTagged: n(t.geo_tagged) }))
    .sort((a, b) => b.reviewed + b.validated + b.applied - (a.reviewed + a.validated + a.applied) || a.teamLeader.localeCompare(b.teamLeader));
  return {
    ...range,
    days,
    people,
    teams,
    totals: {
      outlets: n(raw.distinct.outlets),
      repOutlets: n(raw.distinct.rep_outlets),
      geoTags: days.reduce((s, d) => s + d.geoTags, 0),
      validated: days.reduce((s, d) => s + d.validated, 0),
      sentBack: days.reduce((s, d) => s + d.sentBack, 0),
      people: people.length,
      activeDays: days.filter((d) => d.outlets > 0).length,
    },
  };
}


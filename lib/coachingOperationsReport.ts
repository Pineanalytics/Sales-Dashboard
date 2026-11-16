import type { CoachingSnapshot } from "@/lib/coachingBridge";

// The same Operations Report the Coaching app's admin dashboard offers (web/lib/coachingOperationsReport.ts there), built here from the
// Coaching snapshot the Coaching app pushes every 15 minutes (lib/coachingBridge.ts), already narrowed to the viewer's scope, dates and
// team leader. Keep the analysis and page in step with the Coaching app's copy.

/** One coaching session (accompaniment). */
export interface CoachingRow {
  id: string;
  date: string;
  teamLeader: string;
  rep: string;
  route: string;
  status: string;
  overallScore: number | null;
  startTime: string | null;
  endTime: string | null;
}

/** One outlet visit inside a session. */
export interface CoachingVisitRow {
  id: string;
  accompanimentId: string;
  outletId: string;
  outlet: string;
  outletCode: string;
  place: string;
  principal: string;
  planned: boolean;
  arrivalAt: string | null;
  departureAt: string | null;
  geofence: string | null;
  distanceM: number | null;
}

export interface CoachingActionRow {
  id: string;
  accompanimentId: string;
  teamLeader: string;
  owner: string;
  area: string;
  issue: string;
  requiredAction: string;
  priority: string;
  status: string;
  targetDate: string | null;
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The report's input from a (scoped, filtered) Coaching snapshot. */
export function operationsInputFromSnapshot(snapshot: Pick<CoachingSnapshot, "accompaniments" | "visits" | "actions" | "photos">) {
  const byId = new Map(snapshot.accompaniments.map((a) => [a.id, a]));
  return {
    rows: snapshot.accompaniments.map((a): CoachingRow => ({
      id: a.id,
      date: a.date,
      teamLeader: a.teamLeaderName ?? "",
      rep: a.salesRepName ?? "",
      route: a.routeName ?? "No route",
      status: a.status,
      overallScore: toNumber(a.overall_score),
      startTime: a.start_time ?? null,
      endTime: a.end_time ?? null,
    })),
    visits: snapshot.visits.map((v): CoachingVisitRow => ({
      id: v.id,
      accompanimentId: v.accompaniment_id,
      outletId: v.outlet_id,
      outlet: v.outletName || "Unknown outlet",
      outletCode: v.outletCode ?? "",
      place: v.place ?? "",
      principal: v.visitPrincipal || v.principalName || "",
      planned: v.planned !== false,
      arrivalAt: v.arrival_at ?? null,
      departureAt: v.departure_at ?? null,
      geofence: v.geofence_status ?? null,
      distanceM: toNumber(v.distance_from_outlet_m),
    })),
    actions: snapshot.actions.map((x): CoachingActionRow => {
      const parent = byId.get(x.accompaniment_id);
      return {
        id: x.id,
        accompanimentId: x.accompaniment_id,
        teamLeader: parent?.teamLeaderName ?? "Unknown",
        owner: x.ownerName ?? parent?.salesRepName ?? "Unknown",
        area: x.coaching_area || "General",
        issue: x.issue,
        requiredAction: x.required_action ?? "",
        priority: x.priority,
        status: x.status,
        targetDate: x.target_date,
      };
    }),
    photos: (snapshot.photos ?? []).length,
  };
}

// The coaching operations report: one printable HTML page that sums up the whole coaching operation for the chosen dates. It covers
// who coached whom, which outlets were seen, when the day started and ended, time at each outlet, scores, actions and exceptions.
// It ends with the full activity log, every session with its outlet check-ins and check-outs. The analysis (buildOperationsReport)
// is pure, so it is tested without a database; renderCoachingOperationsHtml only draws it.

const CLOSED = new Set(["completed", "verified", "closed"]);
const NAIROBI_OFFSET_MIN = 180; // East Africa Time, UTC+3 all year (no daylight saving)
const MAX_OUTLET_MIN = 600; // a check-in to check-out longer than this is a missed check-out, not a visit
const MAX_SESSION_MIN = 16 * 60;

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number) => (d > 0 ? round1((n / d) * 100) : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Minutes after midnight, Nairobi time. */
export function minuteOfDay(iso: string | null | undefined): number | null {
  const t = ms(iso);
  if (t === null) return null;
  const m = Math.floor(t / 60_000) + NAIROBI_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}

export function clock(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function duration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Strips a principal's location ("Mars-Nairobi" → "Mars"), so the mix reads by principal. */
export const mainPrincipal = (p: string) => p.replace(/\s*-\s*(Nairobi|Nyeri|Nyahururu|General)\s*$/i, "").trim();

export interface VisitLine {
  outlet: string;
  outletCode: string;
  place: string;
  principal: string;
  planned: boolean;
  arrival: number | null;
  departure: number | null;
  minutes: number | null;
  geofence: string | null;
  distanceM: number | null;
}

export interface Session {
  id: string;
  date: string;
  teamLeader: string;
  rep: string;
  route: string;
  status: string;
  score: number | null;
  start: number | null;
  end: number | null;
  minutes: number | null;
  visits: VisitLine[];
  outlets: number;
  plannedVisits: number;
  minutesAtOutlets: number | null;
}

export interface TeamLeaderLine {
  name: string;
  days: number;
  sessions: number;
  reps: number;
  outlets: number;
  visits: number;
  visitsPerSession: number | null;
  avgStart: number | null;
  avgEnd: number | null;
  avgSession: number | null;
  avgAtOutlet: number | null;
  geofencePct: number | null;
  avgScore: number | null;
  approvedPct: number | null;
  openActions: number;
  overdueActions: number;
}

export interface RepLine {
  name: string;
  teamLeader: string;
  sessions: number;
  lastDate: string;
  daysSinceLast: number | null;
  outlets: number;
  visits: number;
  avgScore: number | null;
  firstScore: number | null;
  latestScore: number | null;
  openActions: number;
}

export interface DayLine {
  date: string;
  weekday: string;
  teamLeaders: number;
  sessions: number;
  reps: number;
  visits: number;
  outlets: number;
  avgStart: number | null;
  avgScore: number | null;
}

export interface Bucket {
  label: string;
  value: number;
}

export interface Exception {
  kind: string;
  count: number;
  note: string;
  examples: string[];
}

export interface OperationsReport {
  asOf: string;
  summary: {
    sessions: number;
    days: number;
    teamLeaders: number;
    reps: number;
    routes: number;
    outlets: number;
    visits: number;
    /** False when the phones never mark a visit as planned, so planned/unplanned is not reported at all. */
    plannedTracked: boolean;
    plannedPct: number | null;
    /** Share of check-ins where the phone had a GPS fix (the geofence check needs one). */
    gpsPct: number | null;
    visitsPerSession: number | null;
    avgStart: number | null;
    avgEnd: number | null;
    avgSession: number | null;
    avgAtOutlet: number | null;
    avgScore: number | null;
    approvedPct: number | null;
    geofencePct: number | null;
    checkoutPct: number | null;
    actions: number;
    actionsClosedPct: number | null;
    overdueActions: number;
    photos: number;
  };
  findings: string[];
  teamLeaders: TeamLeaderLine[];
  reps: RepLine[];
  days: DayLine[];
  arrivalsByHour: Bucket[];
  startsByHour: Bucket[];
  routes: { name: string; sessions: number; visits: number; outlets: number; avgScore: number | null }[];
  principals: Bucket[];
  statuses: Bucket[];
  actionAreas: Bucket[];
  overdue: CoachingActionRow[];
  exceptions: Exception[];
  sessions: Session[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  sales_rep_acknowledged: "Rep acknowledged",
  supervisor_reviewed: "Supervisor reviewed",
  approved: "Approved",
};

function isOverdue(a: CoachingActionRow, today: string) {
  return a.status === "overdue" || (!CLOSED.has(a.status) && !!a.targetDate && a.targetDate < today);
}

function countBy<T>(items: T[], keyOf: (x: T) => string): Bucket[] {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = keyOf(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function sessionOf(row: CoachingRow, visits: CoachingVisitRow[]): Session {
  const lines: VisitLine[] = visits
    .map((v) => {
      const a = ms(v.arrivalAt);
      const d = ms(v.departureAt);
      const minutes = a !== null && d !== null && d >= a && d - a <= MAX_OUTLET_MIN * 60_000 ? (d - a) / 60_000 : null;
      return {
        outlet: v.outlet,
        outletCode: v.outletCode,
        place: v.place,
        principal: v.principal,
        planned: v.planned,
        arrival: minuteOfDay(v.arrivalAt),
        departure: minuteOfDay(v.departureAt),
        minutes,
        geofence: v.geofence,
        distanceM: v.distanceM,
        sortKey: a ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((x, y) => x.sortKey - y.sortKey)
    .map((entry): VisitLine => {
      const { sortKey, ...line } = entry;
      void sortKey;
      return line;
    });

  // The session runs from the phone's start to its end; where either was not recorded, the first check-in or last check-out stands in.
  const arrivals = visits.map((v) => ms(v.arrivalAt)).filter((t): t is number => t !== null);
  const departures = visits.map((v) => ms(v.departureAt)).filter((t): t is number => t !== null);
  const startMs = ms(row.startTime) ?? (arrivals.length ? Math.min(...arrivals) : null);
  const endMs = ms(row.endTime) ?? (departures.length ? Math.max(...departures) : null);
  const length = startMs !== null && endMs !== null && endMs >= startMs && endMs - startMs <= MAX_SESSION_MIN * 60_000 ? (endMs - startMs) / 60_000 : null;
  const timed = lines.map((l) => l.minutes).filter((m): m is number => m !== null);

  return {
    id: row.id,
    date: row.date,
    teamLeader: row.teamLeader.trim() || "Unknown",
    rep: row.rep.trim() || "Unknown",
    route: row.route.trim() || "No route",
    status: row.status,
    score: row.overallScore == null ? null : Number(row.overallScore),
    start: startMs === null ? null : minuteOfDay(new Date(startMs).toISOString()),
    end: endMs === null || length === null ? null : minuteOfDay(new Date(endMs).toISOString()),
    minutes: length,
    visits: lines,
    outlets: new Set(visits.map((v) => v.outletId)).size,
    plannedVisits: lines.filter((l) => l.planned).length,
    minutesAtOutlets: timed.length ? timed.reduce((a, b) => a + b, 0) : null,
  };
}

const known = (v: VisitLine) => !!v.geofence && v.geofence !== "gps_unavailable";

export function buildOperationsReport(
  input: { rows: CoachingRow[]; visits: CoachingVisitRow[]; actions: CoachingActionRow[]; photos: number },
  today: string
): OperationsReport {
  const byAcc = new Map<string, CoachingVisitRow[]>();
  for (const v of input.visits) byAcc.set(v.accompanimentId, [...(byAcc.get(v.accompanimentId) ?? []), v]);
  const outletIdsOf = (ids: string[]) => new Set(ids.flatMap((id) => (byAcc.get(id) ?? []).map((v) => v.outletId)));

  const sessions = input.rows
    .map((r) => sessionOf(r, byAcc.get(r.id) ?? []))
    .sort((a, b) => a.teamLeader.localeCompare(b.teamLeader) || b.date.localeCompare(a.date) || (a.start ?? 0) - (b.start ?? 0));
  const dates = [...new Set(sessions.map((s) => s.date))].sort();
  const asOf = dates.length && dates[dates.length - 1] < today ? dates[dates.length - 1] : today;
  const allVisits = sessions.flatMap((s) => s.visits);
  const scored = sessions.filter((s) => s.score !== null);
  const knownVisits = allVisits.filter(known);
  const avgOf = (list: Session[], pick: (s: Session) => number | null) => mean(list.map(pick).filter((x): x is number => x !== null));
  const atOutlet = (list: Session[]) => mean(list.flatMap((s) => s.visits.map((v) => v.minutes)).filter((m): m is number => m !== null));
  const actionsByAcc = new Map<string, CoachingActionRow[]>();
  for (const a of input.actions) actionsByAcc.set(a.accompanimentId, [...(actionsByAcc.get(a.accompanimentId) ?? []), a]);
  const actionsOf = (list: Session[]) => list.flatMap((s) => actionsByAcc.get(s.id) ?? []);

  const group = (keyOf: (s: Session) => string) => {
    const m = new Map<string, Session[]>();
    for (const s of sessions) m.set(keyOf(s) || "Unknown", [...(m.get(keyOf(s) || "Unknown") ?? []), s]);
    return m;
  };

  const teamLeaders: TeamLeaderLine[] = [...group((s) => s.teamLeader).entries()]
    .map(([name, list]) => {
      const visits = list.flatMap((s) => s.visits);
      const kv = visits.filter(known);
      const sc = list.filter((s) => s.score !== null);
      const submitted = list.filter((s) => s.status !== "draft");
      const acts = actionsOf(list);
      return {
        name,
        days: new Set(list.map((s) => s.date)).size,
        sessions: list.length,
        reps: new Set(list.map((s) => s.rep)).size,
        outlets: outletIdsOf(list.map((s) => s.id)).size,
        visits: visits.length,
        visitsPerSession: list.length ? round1(visits.length / list.length) : null,
        avgStart: avgOf(list, (s) => s.start),
        avgEnd: avgOf(list, (s) => s.end),
        avgSession: avgOf(list, (s) => s.minutes),
        avgAtOutlet: atOutlet(list),
        geofencePct: pct(kv.filter((v) => v.geofence === "inside").length, kv.length),
        avgScore: sc.length ? round1(mean(sc.map((s) => s.score as number))!) : null,
        approvedPct: pct(list.filter((s) => s.status === "approved").length, submitted.length),
        openActions: acts.filter((a) => !CLOSED.has(a.status)).length,
        overdueActions: acts.filter((a) => isOverdue(a, today)).length,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  const reps: RepLine[] = [...group((s) => s.rep).entries()]
    .map(([name, list]) => {
      const chrono = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
      const sc = chrono.filter((s) => s.score !== null);
      const last = chrono[chrono.length - 1];
      return {
        name,
        teamLeader: last.teamLeader,
        sessions: list.length,
        lastDate: last.date,
        daysSinceLast: daysBetween(last.date, asOf),
        outlets: outletIdsOf(list.map((s) => s.id)).size,
        visits: list.reduce((n, s) => n + s.visits.length, 0),
        avgScore: sc.length ? round1(mean(sc.map((s) => s.score as number))!) : null,
        firstScore: sc.length ? sc[0].score : null,
        latestScore: sc.length ? sc[sc.length - 1].score : null,
        openActions: actionsOf(list).filter((a) => !CLOSED.has(a.status)).length,
      };
    })
    .sort((a, b) => a.teamLeader.localeCompare(b.teamLeader) || b.sessions - a.sessions || a.name.localeCompare(b.name));

  const days: DayLine[] = [...group((s) => s.date).entries()]
    .map(([date, list]) => {
      const sc = list.filter((s) => s.score !== null);
      return {
        date,
        weekday: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
        teamLeaders: new Set(list.map((s) => s.teamLeader)).size,
        sessions: list.length,
        reps: new Set(list.map((s) => s.rep)).size,
        visits: list.reduce((n, s) => n + s.visits.length, 0),
        outlets: outletIdsOf(list.map((s) => s.id)).size,
        avgStart: avgOf(list, (s) => s.start),
        avgScore: sc.length ? round1(mean(sc.map((s) => s.score as number))!) : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const hourBuckets = (minutes: (number | null)[]) => {
    const counts = new Map<number, number>();
    for (const m of minutes) if (m !== null) counts.set(Math.floor(m / 60), (counts.get(Math.floor(m / 60)) ?? 0) + 1);
    if (!counts.size) return [];
    const hours = [...counts.keys()];
    const out: Bucket[] = [];
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) out.push({ label: `${String(h).padStart(2, "0")}:00`, value: counts.get(h) ?? 0 });
    return out;
  };

  const routes = [...group((s) => s.route).entries()]
    .map(([name, list]) => {
      const sc = list.filter((s) => s.score !== null);
      return {
        name,
        sessions: list.length,
        visits: list.reduce((n, s) => n + s.visits.length, 0),
        outlets: outletIdsOf(list.map((s) => s.id)).size,
        avgScore: sc.length ? round1(mean(sc.map((s) => s.score as number))!) : null,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  // ------------------------------------------------------------- exceptions: what needs a follow-up
  const label = (s: Session) => `${s.date} · ${s.teamLeader} with ${s.rep}`;
  const take = (list: string[]) => list.slice(0, 8);
  const noOutlets = sessions.filter((s) => s.visits.length === 0);
  const noEnd = sessions.filter((s) => s.visits.length > 0 && s.end === null);
  const drafts = sessions.filter((s) => s.status === "draft");
  const missedCheckout = sessions.flatMap((s) => s.visits.filter((v) => v.minutes === null && v.arrival !== null).map((v) => `${label(s)} · ${v.outlet}`));
  const outside = sessions.flatMap((s) => s.visits.filter((v) => v.geofence === "outside").map((v) => `${label(s)} · ${v.outlet}${v.distanceM != null ? ` (${Math.round(v.distanceM)} m away)` : ""}`));
  const quick = sessions.flatMap((s) => s.visits.filter((v) => v.minutes !== null && v.minutes < 3).map((v) => `${label(s)} · ${v.outlet} (${duration(v.minutes)})`));
  const notRecent = reps.filter((r) => r.daysSinceLast !== null && r.daysSinceLast > 14);
  const overdue = input.actions.filter((a) => isOverdue(a, today)).sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""));
  const exceptions: Exception[] = [
    { kind: "Sessions with no outlet visited", count: noOutlets.length, note: "Started but no outlet was checked in.", examples: take(noOutlets.map(label)) },
    { kind: "Sessions still in draft", count: drafts.length, note: "Not yet submitted by the team leader.", examples: take(drafts.map(label)) },
    { kind: "Sessions with no end time", count: noEnd.length, note: "The session was never ended on the phone and no check-out stands in.", examples: take(noEnd.map(label)) },
    { kind: "Outlet visits with no check-out", count: missedCheckout.length, note: "Time at the outlet can't be measured.", examples: take(missedCheckout) },
    { kind: "Check-ins outside the outlet's geofence", count: outside.length, note: "The phone was not at the outlet's recorded location.", examples: take(outside) },
    { kind: "Outlet visits under 3 minutes", count: quick.length, note: "Too short for real coaching at the outlet.", examples: take(quick) },
    { kind: "Reps not accompanied in the last 14 days of the period", count: notRecent.length, note: "Last seen more than two weeks before the period's end.", examples: take(notRecent.map((r) => `${r.name} (${r.teamLeader}) · last ${r.lastDate}`)) },
    { kind: "Overdue action plans", count: overdue.length, note: "Past their target date and not closed.", examples: take(overdue.map((a) => `${a.owner} · ${a.issue} · due ${a.targetDate ?? "—"}`)) },
  ];

  const submitted = sessions.filter((s) => s.status !== "draft");
  const plannedTracked = allVisits.some((v) => v.planned) && allVisits.some((v) => !v.planned);
  const summary = {
    sessions: sessions.length,
    days: dates.length,
    teamLeaders: teamLeaders.length,
    reps: reps.length,
    routes: routes.filter((r) => r.name !== "No route").length,
    outlets: new Set(input.visits.map((v) => v.outletId)).size,
    visits: allVisits.length,
    plannedTracked,
    plannedPct: plannedTracked ? pct(allVisits.filter((v) => v.planned).length, allVisits.length) : null,
    gpsPct: pct(knownVisits.length, allVisits.length),
    visitsPerSession: sessions.length ? round1(allVisits.length / sessions.length) : null,
    avgStart: avgOf(sessions, (s) => s.start),
    avgEnd: avgOf(sessions, (s) => s.end),
    avgSession: avgOf(sessions, (s) => s.minutes),
    avgAtOutlet: atOutlet(sessions),
    avgScore: scored.length ? round1(mean(scored.map((s) => s.score as number))!) : null,
    approvedPct: pct(sessions.filter((s) => s.status === "approved").length, submitted.length),
    geofencePct: pct(knownVisits.filter((v) => v.geofence === "inside").length, knownVisits.length),
    checkoutPct: pct(allVisits.filter((v) => v.minutes !== null).length, allVisits.length),
    actions: input.actions.length,
    actionsClosedPct: pct(input.actions.filter((a) => CLOSED.has(a.status)).length, input.actions.length),
    overdueActions: overdue.length,
    photos: input.photos,
  };

  // ------------------------------------------------------------- key findings, in plain words
  const findings: string[] = [];
  if (sessions.length) {
    findings.push(
      `${summary.teamLeaders} team leader${summary.teamLeaders === 1 ? "" : "s"} ran ${summary.sessions} coaching session${summary.sessions === 1 ? "" : "s"} with ${summary.reps} rep${summary.reps === 1 ? "" : "s"} over ${summary.days} day${summary.days === 1 ? "" : "s"}, seeing ${summary.outlets} outlet${summary.outlets === 1 ? "" : "s"} in ${summary.visits} visit${summary.visits === 1 ? "" : "s"}.`
    );
    if (summary.avgStart !== null)
      findings.push(
        `A typical session starts at ${clock(summary.avgStart)}${summary.avgEnd !== null ? `, ends at ${clock(summary.avgEnd)}` : ""}${summary.avgSession !== null ? ` and lasts ${duration(summary.avgSession)}` : ""}, covering ${summary.visitsPerSession ?? 0} outlets${summary.avgAtOutlet !== null ? ` at about ${duration(summary.avgAtOutlet)} each` : ""}.`
      );
    const active = teamLeaders.filter((t) => t.sessions >= 3);
    if (teamLeaders.length > 1) {
      const top = teamLeaders[0];
      const low = [...teamLeaders].sort((a, b) => a.sessions - b.sessions)[0];
      findings.push(`Most active: ${top.name} (${top.sessions} sessions, ${top.reps} reps). Least active: ${low.name} (${low.sessions} session${low.sessions === 1 ? "" : "s"}).`);
    }
    const withScores = active.filter((t) => t.avgScore !== null);
    if (withScores.length > 1) {
      const best = [...withScores].sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))[0];
      const worst = [...withScores].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))[0];
      findings.push(`Average score ${summary.avgScore ?? "—"}%; highest ${best.name} at ${best.avgScore}%, lowest ${worst.name} at ${worst.avgScore}% (team leaders with 3+ sessions).`);
    }
    if (summary.gpsPct !== null && summary.gpsPct < 70)
      findings.push(`The phone had no GPS fix on ${round1(100 - summary.gpsPct)}% of check-ins, so the geofence check covers only ${knownVisits.length} of ${allVisits.length} visits.`);
    if (summary.geofencePct !== null) {
      const fence = active.filter((t) => t.geofencePct !== null).sort((a, b) => (a.geofencePct ?? 0) - (b.geofencePct ?? 0))[0];
      findings.push(`${summary.geofencePct}% of check-ins with GPS were inside the outlet's geofence${fence && fence.geofencePct !== null && fence.geofencePct < summary.geofencePct ? `; lowest is ${fence.name} at ${fence.geofencePct}%` : ""}.`);
    }
    const once = reps.filter((r) => r.sessions === 1).length;
    if (reps.length) findings.push(`${once} of ${reps.length} reps were accompanied only once; ${notRecent.length} were not accompanied in the last 14 days of the period.`);
    if (summary.plannedTracked && summary.plannedPct !== null) findings.push(`${summary.plannedPct}% of outlet visits were on the planned route.`);
    if (input.actions.length) findings.push(`${input.actions.length} action plans raised, ${summary.actionsClosedPct ?? 0}% closed, ${overdue.length} overdue.`);
  }

  return {
    asOf,
    summary,
    findings,
    teamLeaders,
    reps,
    days,
    arrivalsByHour: hourBuckets(allVisits.map((v) => v.arrival)),
    startsByHour: hourBuckets(sessions.map((s) => s.start)),
    routes,
    principals: countBy(allVisits, (v) => mainPrincipal(v.principal) || "Not recorded"),
    statuses: countBy(sessions, (s) => STATUS_LABELS[s.status] ?? s.status),
    actionAreas: countBy(input.actions, (a) => a.area || "General"),
    overdue,
    exceptions,
    sessions,
  };
}

// ================================================================= the page

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const num = (n: number | null | undefined, suffix = "") => (n == null ? "—" : `${n.toLocaleString("en-GB")}${suffix}`);
const pctCell = (n: number | null) => (n == null ? "—" : `${n}%`);

function bars(items: Bucket[], max = 12): string {
  const top = items.slice(0, max);
  const peak = Math.max(1, ...top.map((i) => i.value));
  return `<div class="bars">${top
    .map((i) => `<div class="bar"><span class="bl">${esc(i.label)}</span><span class="bt"><span class="bf" style="width:${((i.value / peak) * 100).toFixed(1)}%"></span></span><span class="bv">${i.value}</span></div>`)
    .join("")}</div>`;
}

function columns(items: Bucket[]): string {
  if (!items.length) return `<p class="muted">No times recorded.</p>`;
  const peak = Math.max(1, ...items.map((i) => i.value));
  return `<div class="cols">${items
    .map((i) => `<div class="col"><span class="cv">${i.value || ""}</span><span class="cb" style="height:${((i.value / peak) * 100).toFixed(1)}%"></span><span class="cl">${esc(i.label.slice(0, 2))}</span></div>`)
    .join("")}</div>`;
}

const scoreClass = (s: number | null) => (s == null ? "" : s >= 80 ? "good" : s >= 60 ? "ok" : "bad");
const fenceLabel: Record<string, string> = { inside: "Inside", outside: "Outside", gps_unavailable: "No GPS" };

export function renderCoachingOperationsHtml(formTitle: string, report: OperationsReport, rangeLabel: string, generatedAt = new Date()): string {
  const s = report.summary;
  const when = generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
  const kpi = (label: string, value: string, sub = "") => `<div class="kpi"><div class="kl">${esc(label)}</div><div class="kv">${esc(value)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ""}</div>`;

  const tlRows = report.teamLeaders
    .map(
      (t) => `<tr><td class="name">${esc(t.name)}</td><td>${t.days}</td><td>${t.sessions}</td><td>${t.reps}</td><td>${t.outlets}</td><td>${t.visits}</td><td>${num(t.visitsPerSession)}</td><td>${clock(t.avgStart)}</td><td>${clock(t.avgEnd)}</td><td>${duration(t.avgSession)}</td><td>${duration(t.avgAtOutlet)}</td><td>${pctCell(t.geofencePct)}</td><td class="${scoreClass(t.avgScore)}">${pctCell(t.avgScore)}</td><td>${pctCell(t.approvedPct)}</td><td>${t.openActions}</td><td class="${t.overdueActions ? "bad" : ""}">${t.overdueActions}</td></tr>`
    )
    .join("");

  const repRows = report.reps
    .map((r) => {
      const trend = r.firstScore != null && r.latestScore != null && r.sessions > 1 ? Math.round(r.latestScore - r.firstScore) : null;
      return `<tr data-tl="${esc(r.teamLeader)}"><td class="name">${esc(r.name)}</td><td>${esc(r.teamLeader)}</td><td>${r.sessions}</td><td>${esc(r.lastDate)}</td><td class="${(r.daysSinceLast ?? 0) > 14 ? "bad" : ""}">${num(r.daysSinceLast)}</td><td>${r.outlets}</td><td>${r.visits}</td><td class="${scoreClass(r.avgScore)}">${pctCell(r.avgScore)}</td><td>${pctCell(r.latestScore)}</td><td class="${trend == null ? "" : trend > 0 ? "good" : trend < 0 ? "bad" : ""}">${trend == null ? "—" : `${trend > 0 ? "▲ +" : trend < 0 ? "▼ " : ""}${trend}`}</td><td>${r.openActions}</td></tr>`;
    })
    .join("");

  const peakVisits = Math.max(1, ...report.days.map((d) => d.visits));
  const dayRows = report.days
    .map(
      (d) => `<tr><td>${esc(d.date)}</td><td>${esc(d.weekday)}</td><td>${d.teamLeaders}</td><td>${d.sessions}</td><td>${d.reps}</td><td>${d.outlets}</td><td class="spark"><span class="sb" style="width:${((d.visits / peakVisits) * 100).toFixed(1)}%"></span><span>${d.visits}</span></td><td>${clock(d.avgStart)}</td><td class="${scoreClass(d.avgScore)}">${pctCell(d.avgScore)}</td></tr>`
    )
    .join("");

  const routeRows = report.routes
    .map((r) => `<tr><td class="name">${esc(r.name)}</td><td>${r.sessions}</td><td>${r.visits}</td><td>${r.outlets}</td><td class="${scoreClass(r.avgScore)}">${pctCell(r.avgScore)}</td></tr>`)
    .join("");

  const exceptionBlocks = report.exceptions
    .map(
      (e) => `<div class="exc ${e.count ? "" : "clear"}"><div class="eh"><span class="ec">${e.count}</span><span><b>${esc(e.kind)}</b><br><span class="muted">${esc(e.note)}</span></span></div>${
        e.count ? `<ul>${e.examples.map((x) => `<li>${esc(x)}</li>`).join("")}${e.count > e.examples.length ? `<li class="muted">…and ${e.count - e.examples.length} more</li>` : ""}</ul>` : ""
      }</div>`
    )
    .join("");

  const overdueRows = report.overdue
    .slice(0, 40)
    .map((a) => `<tr><td>${esc(a.targetDate ?? "—")}</td><td>${esc(a.teamLeader)}</td><td>${esc(a.owner)}</td><td>${esc(a.area)}</td><td>${esc(a.issue)}</td><td>${esc(a.requiredAction)}</td><td>${esc(a.priority)}</td></tr>`)
    .join("");

  // The activity log: team leader → session → outlet visits.
  const byLeader = new Map<string, Session[]>();
  for (const x of report.sessions) byLeader.set(x.teamLeader, [...(byLeader.get(x.teamLeader) ?? []), x]);
  const log = [...byLeader.entries()]
    .map(
      ([leader, list]) => `<section class="tl-log" data-tl="${esc(leader)}"><h3>${esc(leader)} <span class="muted">· ${list.length} session${list.length === 1 ? "" : "s"}</span></h3>${list
        .map(
          (x) => `<div class="sess" data-rep="${esc(x.rep.toLowerCase())}"><div class="sh"><b>${esc(x.date)}</b> · ${esc(x.rep)} · <span class="muted">${esc(x.route)}</span><span class="sr">${x.end !== null ? `${clock(x.start)}–${clock(x.end)} · ${duration(x.minutes)}` : x.start !== null ? `started ${clock(x.start)} · not ended` : "no times"} · ${x.visits.length} outlet${x.visits.length === 1 ? "" : "s"} · <span class="${scoreClass(x.score)}">${x.score == null ? "no score" : `${Math.round(x.score)}%`}</span> · ${esc(STATUS_LABELS[x.status] ?? x.status)}</span></div>${
            x.visits.length
              ? `<table class="vt"><thead><tr><th>#</th><th>Outlet</th><th>Place</th><th>Principal</th>${s.plannedTracked ? "<th>Plan</th>" : ""}<th>In</th><th>Out</th><th>Time</th><th>Geofence</th></tr></thead><tbody>${x.visits
                  .map(
                    (v, i) => `<tr><td>${i + 1}</td><td class="name">${esc(v.outlet)}${v.outletCode ? ` <span class="muted">${esc(v.outletCode)}</span>` : ""}</td><td>${esc(v.place || "—")}</td><td>${esc(v.principal || "—")}</td>${s.plannedTracked ? `<td>${v.planned ? "Planned" : "Unplanned"}</td>` : ""}<td>${clock(v.arrival)}</td><td>${clock(v.departure)}</td><td>${duration(v.minutes)}</td><td class="${v.geofence === "outside" ? "bad" : ""}">${esc(v.geofence ? fenceLabel[v.geofence] ?? v.geofence : "—")}${v.geofence === "outside" && v.distanceM != null ? ` (${Math.round(v.distanceM)} m)` : ""}</td></tr>`
                  )
                  .join("")}</tbody></table>`
              : `<p class="muted small">No outlet visits recorded.</p>`
          }</div>`
        )
        .join("")}</section>`
    )
    .join("");

  const leaderOptions = [...byLeader.keys()].map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(formTitle)} — Operations Report</title>
<style>
  :root{--navy:#1F3864;--blue:#2E75B6;--light:#EAF1FB;--grey:#F4F6F8;--border:#E2E6EC;--text:#22293B;--muted:#6b7280;--good:#15803d;--ok:#b45309;--bad:#b91c1c;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:var(--grey);color:var(--text);font-size:13px;}
  header{background:linear-gradient(135deg,var(--navy),var(--blue));color:#fff;padding:22px 28px;}
  header h1{margin:0;font-size:23px;} header p{margin:6px 0 0;opacity:.9;font-size:13px;}
  nav{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--border);padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  nav a{color:var(--navy);text-decoration:none;font-weight:600;font-size:12px;padding:5px 10px;border-radius:999px;background:var(--light);}
  nav .sp{flex:1;}
  select,input[type=search]{padding:6px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff;max-width:100%;}
  button{padding:6px 13px;border:1px solid var(--blue);border-radius:6px;background:var(--blue);color:#fff;font-size:12px;font-weight:600;cursor:pointer;}
  .container{max-width:1320px;margin:0 auto;padding:18px 16px 60px;}
  section.card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px;}
  h2{margin:0 0 4px;font-size:17px;color:var(--navy);} h2+p{margin:0 0 12px;color:var(--muted);font-size:12px;}
  h3{font-size:15px;color:var(--navy);margin:18px 0 8px;}
  .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
  .kpi{border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--grey);}
  .kl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);}
  .kv{font-size:21px;font-weight:700;color:var(--navy);margin-top:3px;} .ks{font-size:11px;color:var(--muted);}
  ul.findings{margin:0;padding-left:18px;line-height:1.65;font-size:13.5px;}
  .tw{overflow-x:auto;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th{background:var(--navy);color:#fff;text-align:left;padding:6px 7px;font-weight:600;white-space:nowrap;position:sticky;top:0;}
  td{padding:5px 7px;border-bottom:1px solid var(--border);white-space:nowrap;}
  td.name{white-space:normal;font-weight:600;min-width:140px;}
  tr:nth-child(even) td{background:#fafbfc;}
  .good{color:var(--good);font-weight:600;} .ok{color:var(--ok);font-weight:600;} .bad{color:var(--bad);font-weight:600;}
  .muted{color:var(--muted);font-weight:400;} .small{font-size:11px;}
  .grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;} .grid2>div{min-width:0;}
  .bars .bar{display:grid;grid-template-columns:150px 1fr 44px;gap:8px;align-items:center;margin:4px 0;}
  .bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .bt{background:var(--light);border-radius:4px;height:14px;display:block;}
  .bf{display:block;height:100%;background:var(--blue);border-radius:4px;} .bv{text-align:right;font-weight:600;}
  .cols{display:flex;align-items:flex-end;gap:4px;height:150px;padding-top:16px;}
  .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}
  .cb{display:block;width:100%;background:var(--blue);border-radius:3px 3px 0 0;min-height:1px;} .cv{font-size:10px;font-weight:600;} .cl{font-size:10px;color:var(--muted);margin-top:3px;}
  td.spark{position:relative;min-width:120px;} .sb{position:absolute;left:0;top:4px;bottom:4px;background:var(--light);border-radius:3px;z-index:0;} td.spark span:last-child{position:relative;font-weight:600;padding-left:4px;}
  .excs{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;}
  .exc{border:1px solid var(--border);border-left:4px solid var(--bad);border-radius:8px;padding:10px 12px;} .exc.clear{border-left-color:var(--good);}
  .eh{display:flex;gap:10px;align-items:flex-start;} .ec{font-size:20px;font-weight:700;color:var(--navy);min-width:36px;}
  .exc ul{margin:8px 0 0;padding-left:18px;font-size:11.5px;line-height:1.5;}
  .tl-log h3{border-bottom:2px solid var(--navy);padding-bottom:4px;}
  .sess{border:1px solid var(--border);border-radius:8px;margin:8px 0;overflow:hidden;break-inside:avoid;}
  .sh{background:var(--light);padding:7px 10px;display:flex;flex-wrap:wrap;gap:4px 8px;} .sr{margin-left:auto;}
  table.vt th{background:#dfe7f3;color:var(--navy);position:static;} table.vt td{font-size:11.5px;}
  footer{text-align:center;color:var(--muted);font-size:11px;padding:20px;}
  @media (max-width:800px){.grid2{grid-template-columns:minmax(0,1fr);} .bars .bar{grid-template-columns:100px 1fr 36px;}}
  @media print{
    @page{size:A4 landscape;margin:10mm;}
    body{background:#fff;font-size:10.5px;} nav,.noprint{display:none!important;}
    header{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:12px 16px;}
    section.card{border:none;padding:0;margin-bottom:14px;break-inside:auto;}
    th,.bf,.cb,.sb,.sh,.kpi{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    th{position:static;} .tw{overflow:visible;} td{white-space:normal;}
    #log{break-before:page;} .hidden-by-filter{display:none!important;}
  }
</style>
</head>
<body>
<header>
  <h1>${esc(formTitle)} — Operations Report</h1>
  <p>${esc(rangeLabel)} · Generated ${esc(when)} (Nairobi time) · All times are Nairobi time</p>
</header>
<nav>
  <a href="#summary">Summary</a><a href="#leaders">Team leaders</a><a href="#reps">Reps</a><a href="#days">Daily</a><a href="#time">Time profile</a><a href="#coverage">Routes &amp; principals</a><a href="#actions">Actions</a><a href="#exceptions">Exceptions</a><a href="#log">Activity log</a>
  <span class="sp"></span>
  <select id="tl" aria-label="Team leader"><option value="">All team leaders</option>${leaderOptions}</select>
  <input type="search" id="rep" placeholder="Find a rep…" aria-label="Find a rep">
  <button type="button" onclick="window.print()">Print / PDF</button>
</nav>
<div class="container">

<section class="card" id="summary">
  <h2>Summary</h2><p>The whole coaching operation for the period at a glance.</p>
  <div class="kpis">
    ${kpi("Coaching sessions", num(s.sessions), `${s.days} working day${s.days === 1 ? "" : "s"}`)}
    ${kpi("Team leaders active", num(s.teamLeaders))}
    ${kpi("Reps accompanied", num(s.reps))}
    ${kpi("Outlets seen", num(s.outlets), `${num(s.visits)} visits`)}
    ${kpi("Outlets per session", num(s.visitsPerSession))}
    ${s.plannedTracked ? kpi("Planned visits", pctCell(s.plannedPct), "on the route plan") : ""}
    ${kpi("Average start", clock(s.avgStart), `ends ${clock(s.avgEnd)}`)}
    ${kpi("Session length", duration(s.avgSession), "average")}
    ${kpi("Time per outlet", duration(s.avgAtOutlet), `${pctCell(s.checkoutPct)} with check-out`)}
    ${kpi("Average score", pctCell(s.avgScore))}
    ${kpi("Approved", pctCell(s.approvedPct), "of submitted")}
    ${kpi("Inside geofence", pctCell(s.geofencePct), `of check-ins with GPS · GPS on ${pctCell(s.gpsPct)}`)}
    ${kpi("Action plans", num(s.actions), `${pctCell(s.actionsClosedPct)} closed · ${s.overdueActions} overdue`)}
    ${kpi("Routes covered", num(s.routes))}
    ${kpi("Photos", num(s.photos))}
  </div>
  <h3>Key findings</h3>
  ${report.findings.length ? `<ul class="findings">${report.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : `<p class="muted">No coaching sessions in this period.</p>`}
</section>

<section class="card" id="leaders">
  <h2>Team leaders</h2><p>Activity, timekeeping and quality per team leader. Times are averages per session.</p>
  <div class="tw"><table><thead><tr><th>Team leader</th><th>Days</th><th>Sessions</th><th>Reps</th><th>Outlets</th><th>Visits</th><th>Outlets / session</th><th>Avg start</th><th>Avg end</th><th>Session</th><th>Per outlet</th><th>Geofence</th><th>Avg score</th><th>Approved</th><th>Open actions</th><th>Overdue</th></tr></thead><tbody>${tlRows}</tbody></table></div>
</section>

<section class="card" id="reps">
  <h2>Rep coverage</h2><p>Each rep accompanied, how often, how recently (days before ${esc(report.asOf)}), and how their score moved from first to latest session.</p>
  <div class="tw"><table id="rep-table"><thead><tr><th>Rep</th><th>Team leader</th><th>Sessions</th><th>Last accompanied</th><th>Days since</th><th>Outlets</th><th>Visits</th><th>Avg score</th><th>Latest</th><th>Change</th><th>Open actions</th></tr></thead><tbody>${repRows}</tbody></table></div>
</section>

<section class="card" id="days">
  <h2>Daily operations</h2><p>What happened each day.</p>
  <div class="tw"><table><thead><tr><th>Date</th><th>Day</th><th>Team leaders</th><th>Sessions</th><th>Reps</th><th>Outlets</th><th>Visits</th><th>Avg start</th><th>Avg score</th></tr></thead><tbody>${dayRows}</tbody></table></div>
</section>

<section class="card" id="time">
  <h2>Time profile</h2><p>When the field day happens: session starts and outlet check-ins by hour.</p>
  <div class="grid2"><div><h3>Session starts by hour</h3>${columns(report.startsByHour)}</div><div><h3>Outlet check-ins by hour</h3>${columns(report.arrivalsByHour)}</div></div>
</section>

<section class="card" id="coverage">
  <h2>Routes &amp; principals</h2><p>Where the coaching took place and which principals the visits were for.</p>
  <div class="grid2">
    <div><h3>Routes</h3><div class="tw"><table><thead><tr><th>Route</th><th>Sessions</th><th>Visits</th><th>Outlets</th><th>Avg score</th></tr></thead><tbody>${routeRows}</tbody></table></div></div>
    <div><h3>Visits by principal</h3>${bars(report.principals, 15)}<h3>Session status</h3>${bars(report.statuses)}</div>
  </div>
</section>

<section class="card" id="actions">
  <h2>Action plans</h2><p>${num(s.actions)} raised · ${pctCell(s.actionsClosedPct)} closed · ${s.overdueActions} overdue.</p>
  <div class="grid2">
    <div><h3>By coaching area</h3>${report.actionAreas.length ? bars(report.actionAreas) : `<p class="muted">No action plans.</p>`}</div>
    <div><h3>Overdue${report.overdue.length > 40 ? " (oldest 40)" : ""}</h3>${overdueRows ? `<div class="tw"><table><thead><tr><th>Due</th><th>Team leader</th><th>Owner</th><th>Area</th><th>Issue</th><th>Action</th><th>Priority</th></tr></thead><tbody>${overdueRows}</tbody></table></div>` : `<p class="muted">Nothing overdue.</p>`}</div>
  </div>
</section>

<section class="card" id="exceptions">
  <h2>Exceptions</h2><p>What needs a follow-up. Green means nothing to flag.</p>
  <div class="excs">${exceptionBlocks}</div>
</section>

<section class="card" id="log">
  <h2>Activity log</h2><p>Every session by team leader, newest first, with each outlet's check-in, check-out and time spent.</p>
  ${log || `<p class="muted">No sessions.</p>`}
</section>

</div>
<footer>${esc(formTitle)} · Coaching Operations Report · ${esc(rangeLabel)}</footer>
<script>
(function(){
  var tl=document.getElementById('tl'), rep=document.getElementById('rep');
  function apply(){
    var t=tl.value, q=rep.value.trim().toLowerCase();
    document.querySelectorAll('.tl-log').forEach(function(sec){
      var show=!t||sec.getAttribute('data-tl')===t, any=false;
      sec.querySelectorAll('.sess').forEach(function(s){var ok=show&&(!q||s.getAttribute('data-rep').indexOf(q)>=0);s.classList.toggle('hidden-by-filter',!ok);s.style.display=ok?'':'none';if(ok)any=true;});
      sec.classList.toggle('hidden-by-filter',!any);sec.style.display=any?'':'none';
    });
    document.querySelectorAll('#rep-table tbody tr').forEach(function(r){
      var ok=(!t||r.getAttribute('data-tl')===t)&&(!q||r.cells[0].textContent.toLowerCase().indexOf(q)>=0);
      r.style.display=ok?'':'none';
    });
  }
  tl.addEventListener('change',apply); rep.addEventListener('input',apply);
})();
</script>
</body>
</html>`;
}

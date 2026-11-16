// The Coaching modules shown on /coaching/insights, the same views the Coaching app's own admin dashboard has (Overview, Team Leaders & Reps,
// Routes, Action Plans, Accompaniments, Photos), worked out from the snapshot the Coaching app pushes (lib/coachingBridge.ts). Pure, so it is
// tested without a database.
import type { CoachingAccompaniment, CoachingAction, CoachingSnapshot, CoachingVisit } from "@/lib/coachingBridge";

export const CLOSED_ACTIONS = new Set(["completed", "verified", "closed"]);

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  sales_rep_acknowledged: "Rep acknowledged",
  supervisor_reviewed: "Supervisor reviewed",
  approved: "Approved",
};

const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (n: number, d: number) => (d > 0 ? round1((n / d) * 100) : 0);

export interface GroupRow {
  name: string;
  accompaniments: number;
  visits: number;
  outlets: number;
  avgScore: number | null;
  approvedPct: number;
  feedbackPct: number;
  geofencePct: number | null;
  /** Average minutes at an outlet, from arrival to departure (visits with both). */
  avgMinutesAtOutlet: number | null;
}

export interface Count {
  label: string;
  value: number;
}

const minutesAt = (v: CoachingVisit): number | null => {
  if (!v.arrival_at || !v.departure_at) return null;
  const m = (Date.parse(v.departure_at) - Date.parse(v.arrival_at)) / 60_000;
  return Number.isFinite(m) && m >= 0 && m < 600 ? m : null;
};

export function groupRows(snapshot: Pick<CoachingSnapshot, "accompaniments" | "visits">, keyOf: (a: CoachingAccompaniment) => string): GroupRow[] {
  const visitsByAcc = new Map<string, CoachingVisit[]>();
  for (const v of snapshot.visits) visitsByAcc.set(v.accompaniment_id, [...(visitsByAcc.get(v.accompaniment_id) ?? []), v]);
  const groups = new Map<string, CoachingAccompaniment[]>();
  for (const a of snapshot.accompaniments) {
    const k = keyOf(a) || "Unassigned";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const visits = list.flatMap((a) => visitsByAcc.get(a.id) ?? []);
      const scored = list.filter((a) => a.overall_score !== null);
      const submitted = list.filter((a) => a.status !== "draft");
      const known = visits.filter((v) => v.geofence_status && v.geofence_status !== "gps_unavailable");
      const minutes = visits.map(minutesAt).filter((m): m is number => m !== null);
      return {
        name,
        accompaniments: list.length,
        visits: visits.length,
        outlets: new Set(visits.map((v) => v.outlet_id)).size,
        avgScore: scored.length ? round1(scored.reduce((s, a) => s + (a.overall_score ?? 0), 0) / scored.length) : null,
        approvedPct: pct(list.filter((a) => a.status === "approved").length, submitted.length),
        feedbackPct: pct(submitted.filter((a) => a.supervisor_comments?.trim()).length, submitted.length),
        geofencePct: known.length ? pct(known.filter((v) => v.geofence_status === "inside").length, known.length) : null,
        avgMinutesAtOutlet: minutes.length ? round1(minutes.reduce((s, m) => s + m, 0) / minutes.length) : null,
      };
    })
    .sort((a, b) => b.accompaniments - a.accompaniments || a.name.localeCompare(b.name));
}

export function dailyCounts(accompaniments: CoachingAccompaniment[]): Count[] {
  const m = new Map<string, number>();
  for (const a of accompaniments) m.set(a.date, (m.get(a.date) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}

export function scoreBuckets(accompaniments: CoachingAccompaniment[]): Count[] {
  const buckets: Count[] = [{ label: "0–39%", value: 0 }, { label: "40–59%", value: 0 }, { label: "60–79%", value: 0 }, { label: "80–100%", value: 0 }];
  for (const a of accompaniments) {
    if (a.overall_score === null) continue;
    buckets[a.overall_score < 40 ? 0 : a.overall_score < 60 ? 1 : a.overall_score < 80 ? 2 : 3].value++;
  }
  return buckets;
}

export function countBy<T>(items: T[], keyOf: (item: T) => string): Count[] {
  const m = new Map<string, number>();
  for (const item of items) {
    const k = keyOf(item);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function isOverdue(action: CoachingAction, today: string): boolean {
  return action.status === "overdue" || (!CLOSED_ACTIONS.has(action.status) && !!action.target_date && action.target_date < today);
}

export interface Kpis {
  accompaniments: number;
  outletVisits: number;
  uniqueOutlets: number;
  avgScore: number | null;
  approvedPct: number;
  geofencePct: number | null;
  actionClosurePct: number;
  overdueActions: number;
  visitations: number;
}

export function kpis(snapshot: Pick<CoachingSnapshot, "accompaniments" | "visits" | "actions">, today: string): Kpis {
  const all = groupRows(snapshot, () => "all")[0];
  return {
    accompaniments: snapshot.accompaniments.filter((a) => a.activityType !== "outlet_visitation").length,
    visitations: snapshot.accompaniments.filter((a) => a.activityType === "outlet_visitation").length,
    outletVisits: snapshot.visits.length,
    uniqueOutlets: new Set(snapshot.visits.map((v) => v.outlet_id)).size,
    avgScore: all?.avgScore ?? null,
    approvedPct: all?.approvedPct ?? 0,
    geofencePct: all?.geofencePct ?? null,
    actionClosurePct: pct(snapshot.actions.filter((a) => CLOSED_ACTIONS.has(a.status)).length, snapshot.actions.length),
    overdueActions: snapshot.actions.filter((a) => isOverdue(a, today)).length,
  };
}

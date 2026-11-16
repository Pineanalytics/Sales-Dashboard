import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const COACHING_FORM_ID = "de8bc27c-c074-4220-a34c-6b07db02a61e";

export type CoachingScope = { allLeaders: boolean; leaderNames: string[] };
export type CoachingAccompaniment = {
  id: string;
  team_leader_id: string;
  sales_rep_id: string;
  teamLeaderName: string;
  salesRepName: string;
  date: string;
  status: "draft" | "submitted" | "sales_rep_acknowledged" | "supervisor_reviewed" | "approved";
  overall_score: number | null;
  supervisor_comments: string | null;
  /** Sent by the Coaching app since Nov 2026 (older snapshots lack them). */
  activityType?: "accompaniment" | "outlet_visitation";
  salesRepCode?: string | null;
  routeName?: string;
  /** When the session was started and ended on the phone (ISO); sent since the Operations Report (older snapshots lack them). */
  start_time?: string | null;
  end_time?: string | null;
};
export type CoachingVisit = {
  id: string;
  accompaniment_id: string;
  outlet_id: string;
  outletName: string;
  /** The outlet's principal in the Coaching app (e.g. "Mars-Nairobi"). */
  principalName: string;
  planned: boolean;
  geofence_status: string | null;
  /** The principal the visit was coached on (the main principal, e.g. "Mars"). */
  visitPrincipal?: string | null;
  arrival_at?: string | null;
  departure_at?: string | null;
  /** The outlet's code and place, and how far the phone was from it at check-in (sent since the Operations Report). */
  outletCode?: string | null;
  place?: string | null;
  distance_from_outlet_m?: number | string | null;
};
export type CoachingAction = {
  id: string;
  accompaniment_id: string;
  issue: string;
  coaching_area: string | null;
  priority: string;
  target_date: string | null;
  status: string;
  required_action?: string | null;
  ownerName?: string | null;
  completed_at?: string | null;
};
export type CoachingPhoto = { url: string; accompaniment_id: string; outletName: string; takenAt: string | null; date: string; latitude: number | null; longitude: number | null };
export type CoachingSnapshot = {
  generatedAt: string;
  principals: { id: string; name: string }[];
  accompaniments: CoachingAccompaniment[];
  visits: CoachingVisit[];
  actions: CoachingAction[];
  photos: CoachingPhoto[];
  /** The team leaders with records in the viewer's scope and dates, for the filter (before the team leader filter is applied). */
  teamLeaders: string[];
};

export type CoachingFilters = { from: string; to: string; principal?: string; teamLeader?: string };

const fold = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** A principal's name without its location: "Mars-Nairobi" -> "mars" (the Coaching app's mainPrincipalName, folded). */
export function mainPrincipalKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/-(Nairobi|Nyeri|Nyahururu|General)$/i, "").trim().toLocaleLowerCase();
}

function bridgeUrl() {
  return `${(process.env.COACHING_APP_URL ?? "https://app.pinefrostdb.com").replace(/\/$/, "")}/api/integrations/analytics/coaching`;
}

async function bridgeRequest(body: Record<string, unknown>) {
  const key = process.env.COACHING_REFERENCE_SYNC_KEY;
  if (!key) throw new Error("The Coaching bridge key is not configured.");
  const response = await fetch(bridgeUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-coaching-reference-key": key },
    body: JSON.stringify({ formId: COACHING_FORM_ID, ...body }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({ error: "The Coaching service returned an invalid response." }))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `The Coaching service returned ${response.status}.`);
  return payload;
}

export async function coachingScopeForUser(user: Session["user"]): Promise<CoachingScope | null> {
  if (user.role === "ADMIN") return { allLeaders: true, leaderNames: [] };
  if (user.role !== "TEAM_LEADER" && user.role !== "SUPERVISOR") return null;
  const scope = await resolveScopeForSession(user.role, user.teamLeaderId, user.allowedPrincipals, user.supervisorId);
  if (!scope?.teamLeaderIds.length) return { allLeaders: false, leaderNames: [] };
  const leaders = await prisma.teamLeader.findMany({
    where: { id: { in: scope.teamLeaderIds } },
    select: { name: true },
  });
  return { allLeaders: false, leaderNames: leaders.map((leader) => leader.name) };
}

type CachedSnapshotPayload = {
  principals: { id: string; name: string }[];
  accompaniments: CoachingAccompaniment[];
  visits: CoachingVisit[];
  actions: CoachingAction[];
  photos?: CoachingPhoto[];
};

/**
 * Applies the viewer's scope/date/principal filter to the full, unscoped
 * snapshot scripts/coaching-dashboard-push.mjs pushes nightly (replacing the
 * per-user filtering app/api/integrations/analytics/coaching/route.ts used to
 * do server-side on every live pull).
 */
export function filterSnapshot(payload: CachedSnapshotPayload, scope: CoachingScope, filters: CoachingFilters) {
  const leaderNames = new Set(scope.leaderNames.map((name) => name.trim().toLocaleLowerCase()));
  const inScope = (item: CoachingAccompaniment) =>
    (scope.allLeaders || leaderNames.has(item.teamLeaderName.trim().toLocaleLowerCase())) &&
    item.date >= filters.from &&
    item.date <= filters.to;

  const inRange = payload.accompaniments.filter(inScope);
  const teamLeaders = [...new Set(inRange.map((item) => item.teamLeaderName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // The key filter: one team leader (as the Coaching app names them), within what the viewer may see.
  const scoped = filters.teamLeader ? inRange.filter((item) => fold(item.teamLeaderName) === fold(filters.teamLeader as string)) : inRange;
  const scopedIds = new Set(scoped.map((item) => item.id));
  const scopedVisits = payload.visits.filter((visit) => scopedIds.has(visit.accompaniment_id));

  // A visit is coached on a main principal ("Mars") while the filter lists each location ("Mars-Nairobi"): match on the main principal, using the
  // principal the visit was coached on when the snapshot has it (the outlet's own principal can be another one).
  const principalName = filters.principal ? payload.principals.find((item) => item.id === filters.principal)?.name : undefined;
  const wanted = mainPrincipalKey(principalName);
  const includedIds = !filters.principal
    ? scopedIds
    : new Set(scopedVisits.filter((visit) => mainPrincipalKey(visit.visitPrincipal || visit.principalName) === wanted).map((visit) => visit.accompaniment_id));

  return {
    principals: payload.principals,
    accompaniments: scoped.filter((item) => includedIds.has(item.id)),
    visits: scopedVisits.filter((visit) => includedIds.has(visit.accompaniment_id)),
    actions: payload.actions.filter((action) => includedIds.has(action.accompaniment_id)),
    photos: (payload.photos ?? []).filter((photo) => includedIds.has(photo.accompaniment_id)),
    teamLeaders,
  };
}

export async function loadCoachingSnapshot(scope: CoachingScope, filters: CoachingFilters): Promise<CoachingSnapshot> {
  const cached = await prisma.coachingSnapshotCache.findUnique({ where: { formId: COACHING_FORM_ID } });
  if (!cached) {
    // No push has landed yet (e.g. right after a fresh deploy, before the
    // nightly job has first run) - fall back to the old live pull so the
    // page isn't empty.
    const { teamLeader, ...rest } = filters;
    const live = (await bridgeRequest({ ...scope, ...rest })) as unknown as CoachingSnapshot;
    return { generatedAt: live.generatedAt, ...filterSnapshot({ ...live, photos: live.photos ?? [] }, { allLeaders: true, leaderNames: [] }, { from: filters.from, to: filters.to, teamLeader }) };
  }
  const filtered = filterSnapshot(cached.payload as unknown as CachedSnapshotPayload, scope, filters);
  return { generatedAt: cached.generatedAt.toISOString(), ...filtered } satisfies CoachingSnapshot;
}

export async function submitCoachingReview(scope: CoachingScope, accompanimentId: string, status: "supervisor_reviewed" | "approved", comments: string) {
  return bridgeRequest({ ...scope, operation: "review", accompanimentId, status, comments });
}

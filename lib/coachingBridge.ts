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
};
export type CoachingVisit = { id: string; accompaniment_id: string; outlet_id: string; outletName: string; principalName: string; planned: boolean; geofence_status: string | null };
export type CoachingAction = { id: string; accompaniment_id: string; issue: string; coaching_area: string | null; priority: string; target_date: string | null; status: string };
export type CoachingSnapshot = {
  generatedAt: string;
  principals: { id: string; name: string }[];
  accompaniments: CoachingAccompaniment[];
  visits: CoachingVisit[];
  actions: CoachingAction[];
};

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
};

/**
 * Applies the viewer's scope/date/principal filter to the full, unscoped
 * snapshot scripts/coaching-dashboard-push.mjs pushes nightly (replacing the
 * per-user filtering app/api/integrations/analytics/coaching/route.ts used to
 * do server-side on every live pull).
 */
function filterSnapshot(payload: CachedSnapshotPayload, scope: CoachingScope, filters: { from: string; to: string; principal?: string }) {
  const leaderNames = new Set(scope.leaderNames.map((name) => name.trim().toLocaleLowerCase()));
  const inScope = (item: CoachingAccompaniment) =>
    (scope.allLeaders || leaderNames.has(item.teamLeaderName.trim().toLocaleLowerCase())) &&
    item.date >= filters.from &&
    item.date <= filters.to;

  const scoped = payload.accompaniments.filter(inScope);
  const scopedIds = new Set(scoped.map((item) => item.id));
  const scopedVisits = payload.visits.filter((visit) => scopedIds.has(visit.accompaniment_id));

  const principalName = filters.principal ? payload.principals.find((item) => item.id === filters.principal)?.name : undefined;
  const includedIds = !filters.principal
    ? scopedIds
    : new Set(scopedVisits.filter((visit) => visit.principalName === principalName).map((visit) => visit.accompaniment_id));

  return {
    principals: payload.principals,
    accompaniments: scoped.filter((item) => includedIds.has(item.id)),
    visits: scopedVisits.filter((visit) => includedIds.has(visit.accompaniment_id)),
    actions: payload.actions.filter((action) => includedIds.has(action.accompaniment_id)),
  };
}

export async function loadCoachingSnapshot(scope: CoachingScope, filters: { from: string; to: string; principal?: string }) {
  const cached = await prisma.coachingSnapshotCache.findUnique({ where: { formId: COACHING_FORM_ID } });
  if (!cached) {
    // No push has landed yet (e.g. right after a fresh deploy, before the
    // nightly job has first run) - fall back to the old live pull so the
    // page isn't empty.
    const payload = await bridgeRequest({ ...scope, ...filters });
    return payload as unknown as CoachingSnapshot;
  }
  const filtered = filterSnapshot(cached.payload as unknown as CachedSnapshotPayload, scope, filters);
  return { generatedAt: cached.generatedAt.toISOString(), ...filtered } satisfies CoachingSnapshot;
}

export async function submitCoachingReview(scope: CoachingScope, accompanimentId: string, status: "supervisor_reviewed" | "approved", comments: string) {
  return bridgeRequest({ ...scope, operation: "review", accompanimentId, status, comments });
}

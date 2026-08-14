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
export type CoachingVisit = { id: string; accompaniment_id: string; outlet_id: string; outletName: string; planned: boolean; geofence_status: string | null };
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

export async function loadCoachingSnapshot(scope: CoachingScope, filters: { from: string; to: string; principal?: string }) {
  const payload = await bridgeRequest({ ...scope, ...filters });
  return payload as unknown as CoachingSnapshot;
}

export async function submitCoachingReview(scope: CoachingScope, accompanimentId: string, status: "supervisor_reviewed" | "approved", comments: string) {
  return bridgeRequest({ ...scope, operation: "review", accompanimentId, status, comments });
}

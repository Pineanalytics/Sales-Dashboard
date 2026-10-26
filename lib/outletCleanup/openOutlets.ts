// The Marked open outlets: outlets a team leader disowned, the teams named as possible owners, and what each has answered.
import { prisma } from "@/lib/db";
import { inActorScope } from "./access";
import { OPEN_OUTLET_OVERDUE_DAYS } from "./progress";
import type { CleanupActor } from "./types";

export interface OpenOutletRow {
  id: string;
  source: string;
  outletKey: string;
  outletName: string;
  principals: string | null;
  territory: string | null;
  region: string | null;
  previousTeamLeader: string | null;
  previousReps: string | null;
  reason: string;
  markedBy: string;
  markedAt: string;
  status: "OPEN" | "CLAIMED" | "UNCLAIMED" | "CLOSED";
  claimedBy: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  candidates: { teamLeader: string; response: "PENDING" | "CLAIMED" | "DECLINED"; note: string | null }[];
  /** Still unsettled after OPEN_OUTLET_OVERDUE_DAYS: the admin allocates it. */
  overdue: boolean;
  /** The team leaders of the signed-in person's scope who may claim or decline it right now. */
  canRespondAs: string[];
}

/** The open outlets a person should see: an admin (or HOD / Director) all of them; a team leader or supervisor those they disowned or were asked about. */
export async function listOpenOutlets(actor: CleanupActor): Promise<{ rows: OpenOutletRow[]; waitingForMe: number; overdue: number }> {
  const all = await prisma.markedOpenOutlet.findMany({ include: { candidates: true }, orderBy: { markedAt: "desc" }, take: 2000 });
  const now = Date.now();
  const rows: OpenOutletRow[] = [];
  for (const item of all) {
    const involved = actor.teamLeaders === null || inActorScope(actor, item.previousTeamLeader) || item.candidates.some((c) => inActorScope(actor, c.teamLeader)) || inActorScope(actor, item.claimedBy);
    if (!involved) continue;
    const unsettled = item.status === "OPEN" || item.status === "UNCLAIMED";
    const canRespondAs = item.status === "OPEN" && (actor.role === "TEAM_LEADER" || actor.role === "SUPERVISOR") ? item.candidates.filter((c) => c.response === "PENDING" && inActorScope(actor, c.teamLeader)).map((c) => c.teamLeader) : [];
    rows.push({
      id: item.id,
      source: item.source,
      outletKey: item.outletKey,
      outletName: item.outletName,
      principals: item.principals,
      territory: item.territory,
      region: item.region,
      previousTeamLeader: item.previousTeamLeader,
      previousReps: item.previousReps,
      reason: item.reason,
      markedBy: item.markedBy,
      markedAt: item.markedAt.toISOString(),
      status: item.status as OpenOutletRow["status"],
      claimedBy: item.claimedBy,
      resolvedBy: item.resolvedBy,
      resolutionNote: item.resolutionNote,
      candidates: item.candidates.map((c) => ({ teamLeader: c.teamLeader, response: c.response as "PENDING" | "CLAIMED" | "DECLINED", note: c.note })),
      overdue: unsettled && now - item.markedAt.getTime() > OPEN_OUTLET_OVERDUE_DAYS * 86_400_000,
      canRespondAs,
    });
  }
  return { rows, waitingForMe: rows.filter((r) => r.canRespondAs.length > 0).length, overdue: rows.filter((r) => r.overdue).length };
}

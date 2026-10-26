import { NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { listOpenOutlets } from "@/lib/outletCleanup/openOutlets";
import { loadProgress } from "@/lib/outletCleanup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

/** The small payload behind the reminder every team leader and supervisor sees when the dashboard opens. Anyone else gets show: false. */
export async function GET() {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ show: false }, { headers: noStore });
  const { actor } = access;
  if (actor.role !== "TEAM_LEADER" && actor.role !== "SUPERVISOR") return NextResponse.json({ show: false }, { headers: noStore });
  try {
    const [progress, open] = await Promise.all([loadProgress(actor), listOpenOutlets(actor)]);
    const own = actor.role === "TEAM_LEADER" ? progress.mine[0] : null;
    return NextResponse.json(
      {
        show: true,
        name: actor.displayName,
        role: actor.role,
        period: progress.period,
        teams: progress.mine.length,
        outlets: progress.totals.outlets,
        reviewed: progress.totals.reviewed,
        pctReviewed: progress.totals.pctReviewed,
        missingGeo: progress.totals.missingGeo,
        targetPct: own?.targetPct ?? progress.defaultTargetPct,
        attainment: own?.attainment ?? null,
        rank: own?.rank ?? null,
        rankedTeams: progress.teams.length,
        waitingForMe: open.waitingForMe,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Failed to load the cleanup summary", error);
    return NextResponse.json({ show: false });
  }
}

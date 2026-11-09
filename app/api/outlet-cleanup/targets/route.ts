import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError, clearCleanupTarget, setCleanupTarget } from "@/lib/outletCleanup/actions";
import { loadTeamLeaderOptions } from "@/lib/outletCleanup/data";
import { currentPeriod, isPeriod, loadTargets } from "@/lib/outletCleanup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The month's targets (admin only): the default for everyone and any team leader's own. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Not allowed." }, { status: access.status });
  if (!access.actor.isAdmin) return NextResponse.json({ error: "Only an admin sets targets." }, { status: 403 });
  const asked = req.nextUrl.searchParams.get("period") ?? "";
  const period = isPeriod(asked) ? asked : currentPeriod();
  const [targets, teamLeaders] = await Promise.all([loadTargets(period), loadTeamLeaderOptions()]);
  return NextResponse.json({ period, defaultPct: targets.defaultPct, overrides: [...targets.byTeam.entries()].map(([teamLeader, targetPct]) => ({ teamLeader, targetPct })), teamLeaders }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Sets (or, with clear: true, removes) a target. */
export async function POST(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "Not allowed." }, { status: access.status });
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const period = typeof input?.period === "string" ? input.period : "";
  const teamLeader = typeof input?.teamLeader === "string" ? input.teamLeader.slice(0, 120) : "*";
  try {
    if (input?.clear === true) await clearCleanupTarget(access.actor, { period, teamLeader });
    else await setCleanupTarget(access.actor, { period, teamLeader, targetPct: Number(input?.targetPct) });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CleanupError) return NextResponse.json({ error: error.message, fields: error.fields ?? [] }, { status: error.status });
    console.error("Failed to save the cleanup target", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}

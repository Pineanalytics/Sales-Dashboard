import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { loadTracker, trackerRange } from "@/lib/outletCleanup/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cleanup tracker for the person's own teams: work done per day and per person between `from` and `to` (YYYY-MM-DD, this month by default), and where every saved outlet stands per team leader. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  if (access.actor.repCodes) return NextResponse.json({ error: "The tracker is for team leaders and supervisors." }, { status: 403 });
  try {
    const params = req.nextUrl.searchParams;
    const report = await loadTracker(access.actor, trackerRange(params.get("from"), params.get("to")));
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the cleanup tracker", error);
    return NextResponse.json({ error: "Failed to load the cleanup tracker." }, { status: 500 });
  }
}

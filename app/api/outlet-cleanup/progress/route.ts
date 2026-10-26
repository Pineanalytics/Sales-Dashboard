import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { currentPeriod, isPeriod, loadProgress } from "@/lib/outletCleanup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cleanup progress per team against the month's target, ranked; `mine` is the signed-in person's own teams. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  try {
    const asked = req.nextUrl.searchParams.get("period") ?? "";
    const report = await loadProgress(access.actor, isPeriod(asked) ? asked : currentPeriod());
    return NextResponse.json({ ...report, actor: { role: access.actor.role, isAdmin: access.actor.isAdmin, name: access.actor.displayName } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the cleanup progress", error);
    return NextResponse.json({ error: "Failed to load the cleanup progress." }, { status: 500 });
  }
}

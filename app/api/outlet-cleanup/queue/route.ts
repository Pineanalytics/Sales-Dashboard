import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { listQueue, loadCleanupOptions, parseQueueFilters } from "@/lib/outletCleanup/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outlets the signed-in team leader, supervisor or admin works on, with what they have verified laid over the universe's values. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  try {
    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const [queue, options] = await Promise.all([listQueue(access.actor, parseQueueFilters(params), page), loadCleanupOptions()]);
    return NextResponse.json({ ...queue, options, actor: { role: access.actor.role, isAdmin: access.actor.isAdmin, name: access.actor.displayName } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the cleanup queue", error);
    return NextResponse.json({ error: "Failed to load the cleanup queue." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { loadQueueFilterOptions, parseQueueFilters } from "@/lib/outletCleanup/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The reps and territories on the signed-in person's outlets, for the cleanup list's filters. Each list is narrowed by the other's current choice. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  try {
    const { rep, territory } = parseQueueFilters(req.nextUrl.searchParams);
    return NextResponse.json(await loadQueueFilterOptions(access.actor, { rep, territory }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the cleanup filters", error);
    return NextResponse.json({ error: "Failed to load the cleanup filters." }, { status: 500 });
  }
}

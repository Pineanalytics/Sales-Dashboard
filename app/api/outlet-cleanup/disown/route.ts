import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError, disownOutlets } from "@/lib/outletCleanup/actions";
import { loadTeamLeaderOptions } from "@/lib/outletCleanup/data";
import { MAX_BULK_DISOWN } from "@/lib/outletCleanup/disown";
import { OUTLET_SOURCES, type OutletSource } from "@/lib/outletUniverse/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asText = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/** The team leaders from other teams an outlet can be offered to. */
export async function GET() {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  try {
    const { actor } = access;
    const teamLeaders = (await loadTeamLeaderOptions()).filter((n) => !actor.teamLeaders?.some((mine) => mine.toLowerCase() === n.toLowerCase()));
    return NextResponse.json({ teamLeaders }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the team leaders for disowning", error);
    return NextResponse.json({ error: "Failed to load the team leaders." }, { status: 500 });
  }
}

/** Disowns the chosen outlets together: one reason, and either the team leaders who may own them or the owner declared unknown. */
export async function POST(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  const { actor } = access;
  if (actor.role === "HOD" || actor.role === "DIRECTOR") return NextResponse.json({ error: "HOD and Director accounts can view the cleanup but not change it." }, { status: 403 });
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input || !Array.isArray(input.items)) return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  if (input.items.length > MAX_BULK_DISOWN) return NextResponse.json({ error: `Disown at most ${MAX_BULK_DISOWN} outlets at a time.` }, { status: 400 });
  const items: { source: OutletSource; outletKey: string }[] = [];
  for (const raw of input.items as Record<string, unknown>[]) {
    const source = String(raw?.source);
    const outletKey = asText(raw?.outletKey, 200);
    if (!(OUTLET_SOURCES as string[]).includes(source) || outletKey === "") return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
    items.push({ source: source as OutletSource, outletKey });
  }
  const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 30).map((c) => asText(c, 120)) : [];
  try {
    const result = await disownOutlets(actor, items, { reason: asText(input.reason, 300), candidates, ownerUnknown: input.ownerUnknown === true });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CleanupError) return NextResponse.json({ error: error.message, fields: error.fields ?? [] }, { status: error.status });
    console.error("Failed to disown the chosen outlets", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}

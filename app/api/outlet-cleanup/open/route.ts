import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError, resolveOpenOutlet, respondToOpenOutlet } from "@/lib/outletCleanup/actions";
import { loadTeamLeaderOptions } from "@/lib/outletCleanup/data";
import { listOpenOutlets } from "@/lib/outletCleanup/openOutlets";
import { OPEN_OUTLET_OVERDUE_DAYS } from "@/lib/outletCleanup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const denied = (status: 401 | 403) => NextResponse.json({ error: status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status });

/** The marked-open outlets this person disowned, was asked about, or (admin) all of them. */
export async function GET() {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  try {
    const [open, teamLeaders] = await Promise.all([listOpenOutlets(access.actor), access.actor.isAdmin ? loadTeamLeaderOptions() : Promise.resolve([] as string[])]);
    return NextResponse.json({ ...open, teamLeaders, overdueDays: OPEN_OUTLET_OVERDUE_DAYS, isAdmin: access.actor.isAdmin }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the marked open outlets", error);
    return NextResponse.json({ error: "Failed to load the marked open outlets." }, { status: 500 });
  }
}

/** Claim or decline a marked-open outlet (a named team), or (admin) allocate or close one. */
export async function POST(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  const { actor } = access;
  if (actor.role === "HOD" || actor.role === "DIRECTOR") return NextResponse.json({ error: "HOD and Director accounts can view the cleanup but not change it." }, { status: 403 });
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof input?.id === "string" ? input.id.slice(0, 60) : "";
  const note = typeof input?.note === "string" ? input.note.slice(0, 300) : undefined;
  if (!input || !id) return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  try {
    if (input.action === "respond" && (input.response === "CLAIM" || input.response === "DECLINE") && typeof input.teamLeader === "string") {
      await respondToOpenOutlet(actor, id, { response: input.response, teamLeader: input.teamLeader.slice(0, 120), note });
    } else if (input.action === "resolve" && (input.decision === "ASSIGN" || input.decision === "CLOSE")) {
      await resolveOpenOutlet(actor, id, { decision: input.decision, teamLeader: typeof input.teamLeader === "string" ? input.teamLeader.slice(0, 120) : undefined, note });
    } else {
      return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CleanupError) return NextResponse.json({ error: error.message, fields: error.fields ?? [] }, { status: error.status });
    console.error("Failed to save the marked open outlet answer", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}

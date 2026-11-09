import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError } from "@/lib/outletCleanup/actions";
import { createRoute, listRoutes, loadRouteLocations } from "@/lib/outletCleanup/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const denied = (status: 401 | 403) => NextResponse.json({ error: status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status });

/** The routes of the person's teams with their outlet counts; with ?teamLeader=, also the places that team leader's outlets sit in (what a route can be named after). */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  try {
    const list = await listRoutes(access.actor);
    const asked = (req.nextUrl.searchParams.get("teamLeader") ?? "").trim().slice(0, 120);
    const locations = asked && list.teamLeaders.some((n) => n.toLowerCase() === asked.toLowerCase()) ? await loadRouteLocations(asked) : [];
    return NextResponse.json({ ...list, locations, canCreate: access.actor.role !== "HOD" && access.actor.role !== "DIRECTOR" }, { headers: noStore });
  } catch (error) {
    console.error("Failed to load the routes", error);
    return NextResponse.json({ error: "Failed to load the routes." }, { status: 500 });
  }
}

/** Names a new route for a team leader. */
export async function POST(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input || typeof input.teamLeader !== "string" || typeof input.name !== "string") return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  const locations = Array.isArray(input.locations) ? input.locations.filter((l): l is string => typeof l === "string").slice(0, 6).map((l) => l.slice(0, 120)) : [];
  try {
    const route = await createRoute(access.actor, { teamLeader: input.teamLeader.slice(0, 120), name: input.name.slice(0, 120), locations });
    return NextResponse.json({ ok: true, route: { id: route.id, teamLeader: route.teamLeader, name: route.name } }, { headers: noStore });
  } catch (error) {
    if (error instanceof CleanupError) return NextResponse.json({ error: error.message, fields: error.fields ?? [] }, { status: error.status });
    console.error("Failed to name the route", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}

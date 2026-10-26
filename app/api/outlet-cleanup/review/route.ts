import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { CleanupError, reviewDuplicates, reviewEntries } from "@/lib/outletCleanup/actions";
import { listDuplicateReviews, listReviewEntries } from "@/lib/outletCleanup/review";
import { loadTeamLeaderOptions } from "@/lib/outletCleanup/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

const denied = (status: 401 | 403) => NextResponse.json({ error: status === 401 ? "Sign in required." : "Not allowed." }, { status });

/** The staged work waiting for an admin: entries (kind=entries) or duplicate calls (kind=duplicates), by status. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  if (!access.actor.isAdmin) return NextResponse.json({ error: "Only an admin reviews the cleanup." }, { status: 403 });
  try {
    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const status = (params.get("status") ?? "REVIEWED").slice(0, 12);
    if (params.get("kind") === "duplicates") return NextResponse.json(await listDuplicateReviews({ status }, page), { headers: noStore });
    const teamLeader = (params.get("teamLeader") ?? "").trim().slice(0, 120) || null;
    const [list, teamLeaders] = await Promise.all([listReviewEntries({ status, q: (params.get("q") ?? "").trim().slice(0, 80), teamLeader }, page), loadTeamLeaderOptions()]);
    return NextResponse.json({ ...list, teamLeaders }, { headers: noStore });
  } catch (error) {
    console.error("Failed to load the cleanup review", error);
    return NextResponse.json({ error: "Failed to load the cleanup review." }, { status: 500 });
  }
}

/** Validate or reject entries or duplicate calls. */
export async function POST(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return denied(access.status);
  const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = Array.isArray(input?.ids) ? input.ids.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
  const decision = input?.decision === "VALIDATE" || input?.decision === "REJECT" ? input.decision : null;
  if (!input || !decision) return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  const note = typeof input.note === "string" ? input.note.slice(0, 300) : undefined;
  try {
    const result = input.kind === "duplicates" ? await reviewDuplicates(access.actor, { ids, decision, note }) : await reviewEntries(access.actor, { ids, decision, note });
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (error) {
    if (error instanceof CleanupError) return NextResponse.json({ error: error.message, fields: error.fields ?? [] }, { status: error.status });
    console.error("Failed to save the cleanup review", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }
}

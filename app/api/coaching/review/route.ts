import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { coachingScopeForUser, submitCoachingReview } from "@/lib/coachingBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPERVISOR")) {
    return NextResponse.json({ error: "Only supervisors and administrators can review Coaching records." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { accompanimentId?: unknown; status?: unknown; comments?: unknown } | null;
  if (!body || typeof body.accompanimentId !== "string" || (body.status !== "supervisor_reviewed" && body.status !== "approved")) {
    return NextResponse.json({ error: "A valid review decision is required." }, { status: 400 });
  }
  const scope = await coachingScopeForUser(session.user);
  if (!scope) return NextResponse.json({ error: "You do not have Coaching access." }, { status: 403 });
  try {
    const result = await submitCoachingReview(scope, body.accompanimentId, body.status, typeof body.comments === "string" ? body.comments : "");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the review." }, { status: 502 });
  }
}

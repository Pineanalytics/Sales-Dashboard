import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidBridgeKey(request: NextRequest) {
  const expected = process.env.COACHING_REFERENCE_SYNC_KEY;
  const provided = request.headers.get("x-coaching-reference-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

type SnapshotPushBody = {
  formId?: unknown;
  generatedAt?: unknown;
  principals?: unknown;
  accompaniments?: unknown;
  visits?: unknown;
  actions?: unknown;
};

/**
 * Receives the full, unscoped nightly Coaching snapshot
 * (scripts/coaching-dashboard-push.mjs in the Coaching app), replacing the
 * pattern where every /coaching page load pulled a scoped slice live from
 * that app (lib/coachingBridge.ts here, which still falls back to that live
 * pull if no push has landed yet). See docs/automation-registry.md.
 */
export async function POST(request: NextRequest) {
  if (!hasValidBridgeKey(request)) {
    return NextResponse.json({ error: "Invalid Coaching bridge credentials." }, { status: 401 });
  }

  let body: SnapshotPushBody;
  try {
    body = (await request.json()) as SnapshotPushBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const formId = typeof body.formId === "string" ? body.formId : "";
  const generatedAt = typeof body.generatedAt === "string" ? new Date(body.generatedAt) : null;
  if (!formId || !generatedAt || Number.isNaN(generatedAt.getTime()) || !Array.isArray(body.accompaniments)) {
    return NextResponse.json({ error: "A valid snapshot payload is required." }, { status: 400 });
  }

  const payload = {
    principals: Array.isArray(body.principals) ? body.principals : [],
    accompaniments: body.accompaniments,
    visits: Array.isArray(body.visits) ? body.visits : [],
    actions: Array.isArray(body.actions) ? body.actions : [],
  };

  try {
    await prisma.coachingSnapshotCache.upsert({
      where: { formId },
      create: { formId, generatedAt, accompanimentCount: payload.accompaniments.length, payload },
      update: { generatedAt, accompanimentCount: payload.accompaniments.length, payload },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not store the snapshot." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accompanimentCount: payload.accompaniments.length });
}

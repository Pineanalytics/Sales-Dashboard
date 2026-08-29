import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Polled every few minutes by each Centegy machine's own scheduled task
 * (scripts/sales-returns-trigger-poll.ps1) — this is the "pull" half of the
 * manual-trigger queue described on SalesReturnsTriggerRequest's model
 * comment. Claims (not just reads) the oldest pending request for the
 * calling machine's own `distributor`, so a second poll a few minutes later
 * won't pick up the same request again while the first run is still going.
 * API-key-only (`UPLOAD_API_KEY`, same as the rest of this bridge) — never
 * session-authenticated.
 */
export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const distributor = new URL(req.url).searchParams.get("distributor");
  if (!distributor) return NextResponse.json({ error: '"distributor" query param is required.' }, { status: 400 });

  const next = await prisma.salesReturnsTriggerRequest.findFirst({
    where: { distributor, status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });
  if (!next) return NextResponse.json({ pending: false });

  // Compare-and-swap on status: if two polls somehow race, only the first
  // update actually flips PENDING -> CLAIMED (count 1); the loser sees
  // count 0 and reports nothing pending instead of double-claiming.
  const claim = await prisma.salesReturnsTriggerRequest.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });
  if (claim.count === 0) return NextResponse.json({ pending: false });

  return NextResponse.json({
    pending: true,
    id: next.id,
    window: next.window,
    backfillFrom: next.backfillFrom ? next.backfillFrom.toISOString().slice(0, 10) : null,
  });
}

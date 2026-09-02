import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasUpfieldDataEdgeUploadKey } from "@/lib/upfieldDataEdgeTriggerAuth";

export const runtime = "nodejs";

/** Claimed by the DataEdge machine's local trigger poller. */
export async function GET(request: NextRequest) {
  if (!hasUpfieldDataEdgeUploadKey(request)) {
    return NextResponse.json({ error: "Invalid upload credentials." }, { status: 401 });
  }

  const next = await prisma.upfieldDataEdgeTriggerRequest.findFirst({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });
  if (!next) return NextResponse.json({ pending: false });

  const claim = await prisma.upfieldDataEdgeTriggerRequest.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: { status: "CLAIMED", claimedAt: new Date() },
  });
  if (claim.count === 0) return NextResponse.json({ pending: false });
  return NextResponse.json({ pending: true, id: next.id });
}

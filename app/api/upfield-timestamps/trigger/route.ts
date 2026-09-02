import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Queue a DataEdge refresh for the machine's outbound trigger poller. */
export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  const existing = await prisma.upfieldDataEdgeTriggerRequest.findFirst({
    where: { status: { in: ["PENDING", "CLAIMED"] } },
    orderBy: { requestedAt: "desc" },
  });
  if (existing) return NextResponse.json({ request: existing, alreadyQueued: true });

  const request = await prisma.upfieldDataEdgeTriggerRequest.create({
    data: { requestedBy: session.user.email ?? null },
  });
  return NextResponse.json({ request, alreadyQueued: false });
}

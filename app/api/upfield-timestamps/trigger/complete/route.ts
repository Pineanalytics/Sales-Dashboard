import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasUpfieldDataEdgeUploadKey } from "@/lib/upfieldDataEdgeTriggerAuth";

export const runtime = "nodejs";

/** Records whether the source machine actually dispatched its local uploader. */
export async function POST(request: NextRequest) {
  if (!hasUpfieldDataEdgeUploadKey(request)) {
    return NextResponse.json({ error: "Invalid upload credentials." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.id !== "string" || typeof body.success !== "boolean") {
    return NextResponse.json({ error: 'Expected a request "id" and boolean "success".' }, { status: 400 });
  }

  await prisma.upfieldDataEdgeTriggerRequest.updateMany({
    where: { id: body.id, status: "CLAIMED" },
    data: {
      status: body.success ? "COMPLETED" : "FAILED",
      completedAt: new Date(),
      resultSummary: typeof body.summary === "string" ? body.summary.slice(0, 1_000) : null,
    },
  });
  return NextResponse.json({ ok: true });
}

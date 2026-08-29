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

/** Called by scripts/sales-returns-trigger-poll.ps1 once it's actually run
 *  (or failed to run) the sync for a claimed request. API-key-only, same as
 *  the rest of this bridge. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { id?: unknown; status?: unknown; resultSummary?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "id" and "status".' }, { status: 400 });
  }
  if (typeof body.id !== "string" || (body.status !== "COMPLETED" && body.status !== "FAILED")) {
    return NextResponse.json({ error: '"id" must be a string and "status" must be "COMPLETED" or "FAILED".' }, { status: 400 });
  }

  await prisma.salesReturnsTriggerRequest.update({
    where: { id: body.id },
    data: {
      status: body.status,
      completedAt: new Date(),
      resultSummary: typeof body.resultSummary === "string" ? body.resultSummary.slice(0, 2000) : null,
    },
  });
  return NextResponse.json({ ok: true });
}

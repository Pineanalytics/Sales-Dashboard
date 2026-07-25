import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Date-range scoped read of JourneyPlanRow (uses the existing @@index([date])).
// Machine-to-machine only, like /api/active-outlets/sync-state — this is what
// scripts/db-bridge/jp-adherence/run.ts's incremental mode reads back instead
// of regenerating the route from a fresh 90-day fetch every run (see that
// file's header comment for the full full/incremental split rationale).
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: '"from" and "to" query params (ISO dates) are required.' }, { status: 400 });
  }

  const rows = await prisma.journeyPlanRow.findMany({
    where: { date: { gte: new Date(from), lte: new Date(to) } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({ rows });
}

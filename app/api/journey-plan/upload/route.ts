import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { lockSalesReturnsUpload } from "@/lib/salesReturnsUploadLock";

export const runtime = "nodejs";

const CHUNK_SIZE = 500;

interface JourneyPlanAssignmentUploadRow {
  distributor: string;
  pjp: string;
  routeDesc: string;
  customerCode: string;
  sequenceDay: number | null;
  workingDay: number | null;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isValidRow(value: unknown): value is JourneyPlanAssignmentUploadRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.distributor === "string" &&
    typeof row.pjp === "string" &&
    typeof row.routeDesc === "string" &&
    typeof row.customerCode === "string" &&
    (row.sequenceDay === null || typeof row.sequenceDay === "number") &&
    (row.workingDay === null || typeof row.workingDay === "number")
  );
}

/** Replaces one distributor's whole outlet-to-PJP roster — a full current-
 *  state recompute every run (see scripts/db-bridge/sales-returns/journeyPlanQuery.ts),
 *  not a per-day append. API-key-only, same UPLOAD_API_KEY shared secret as
 *  the rest of this bridge — never session-authenticated. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  let body: { rows?: unknown; distributor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || !body.rows.every(isValidRow)) {
    return NextResponse.json({ error: "One or more journey-plan roster rows are invalid." }, { status: 400 });
  }
  const distributor = typeof body.distributor === "string" && /^\d+$/.test(body.distributor) ? body.distributor : null;
  if (!distributor) return NextResponse.json({ error: '"distributor" is required.' }, { status: 400 });

  const rows = body.rows as JourneyPlanAssignmentUploadRow[];
  if (rows.some((row) => row.distributor !== distributor)) {
    return NextResponse.json({ error: "Every row must match the requested distributor." }, { status: 400 });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        await lockSalesReturnsUpload(tx, "journey-plan", [distributor]);
        await tx.journeyPlanAssignment.deleteMany({ where: { distributor } });
        for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
          await tx.journeyPlanAssignment.createMany({ data: rows.slice(index, index + CHUNK_SIZE) });
        }
      },
      { maxWait: 120_000, timeout: 120_000 }
    );
    return NextResponse.json({ count: rows.length });
  } catch (error) {
    console.error("Failed to replace journey-plan roster rows", error);
    return NextResponse.json({ error: "Failed to save journey-plan roster data." }, { status: 500 });
  }
}

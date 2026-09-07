import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isSalesReturnsExtractionSerial,
  isSalesReturnsExtractionStatus,
} from "@/lib/salesReturnsExtraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Records run identity separately from the replace-in-place report facts.
 * STARTED creates the immutable branch/window identity; COMPLETED or FAILED
 * closes that same serial without changing its distributor or date window. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const payload = body as Record<string, unknown> | null;
  if (
    !payload ||
    !isSalesReturnsExtractionSerial(payload.extractionSerial) ||
    typeof payload.distributor !== "string" ||
    !/^\d+$/.test(payload.distributor) ||
    !validDate(payload.windowStart) ||
    !validDate(payload.windowEnd) ||
    !isSalesReturnsExtractionStatus(payload.status)
  ) {
    return NextResponse.json({ error: "Invalid Sales & Returns extraction-run payload." }, { status: 400 });
  }

  const windowStart = new Date(payload.windowStart);
  const windowEnd = new Date(payload.windowEnd);
  if (windowEnd <= windowStart) {
    return NextResponse.json({ error: "windowEnd must be later than windowStart." }, { status: 400 });
  }

  const counts = {
    invoiceLineCount: validCount(payload.invoiceLineCount) ? payload.invoiceLineCount : 0,
    pjpSkuCount: validCount(payload.pjpSkuCount) ? payload.pjpSkuCount : 0,
    outletSkuCount: validCount(payload.outletSkuCount) ? payload.outletSkuCount : 0,
    activityCount: validCount(payload.activityCount) ? payload.activityCount : 0,
  };
  const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage.slice(0, 2_000) : null;
  const completedAt = payload.status === "STARTED" ? null : new Date();

  try {
    const existing = await prisma.salesReturnsExtractionRun.findUnique({
      where: { extractionSerial: payload.extractionSerial },
      select: { distributor: true, windowStart: true, windowEnd: true },
    });
    if (
      existing &&
      (existing.distributor !== payload.distributor ||
        existing.windowStart.getTime() !== windowStart.getTime() ||
        existing.windowEnd.getTime() !== windowEnd.getTime())
    ) {
      return NextResponse.json({ error: "Extraction serial already belongs to a different branch or date window." }, { status: 409 });
    }

    const run = await prisma.salesReturnsExtractionRun.upsert({
      where: { extractionSerial: payload.extractionSerial },
      create: {
        extractionSerial: payload.extractionSerial,
        distributor: payload.distributor,
        windowStart,
        windowEnd,
        status: payload.status,
        ...counts,
        errorMessage,
        completedAt,
      },
      update: {
        status: payload.status,
        ...counts,
        errorMessage,
        completedAt,
      },
      select: { extractionSerial: true, status: true, completedAt: true },
    });
    return NextResponse.json(run);
  } catch (error) {
    console.error("Failed to record Sales & Returns extraction run", error);
    return NextResponse.json({ error: "Failed to record extraction run." }, { status: 500 });
  }
}

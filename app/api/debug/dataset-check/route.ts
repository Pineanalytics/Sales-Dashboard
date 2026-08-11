import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { decodeDataset } from "@/lib/snapshotCodec";

export const runtime = "nodejs";

// TEMPORARY diagnostic route — API-key-gated, read-only, removed once its
// one-off question is answered. Checking what's actually in the live,
// currently-served Dataset's monthlyBrandCustomer, since WeekDailyActuals is
// showing all-zero actuals in production despite passing verification locally
// against the user's own Sales update.xlsx — need to confirm whether the
// dataset actually uploaded to production carries the new Date-column shape.
function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  const snapshot = await prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } });
  if (!snapshot) return NextResponse.json({ found: false });

  const dataset = decodeDataset(snapshot.data);
  const bc = dataset.monthlyBrandCustomer;

  const distinctYearMonths = [...new Set(bc.map((r) => `${r.year}-${r.monthIndex}`))].sort();
  const sample = bc.slice(0, 3);
  const hasDateField = bc.length > 0 && "date" in bc[0];
  const distinctDates = [...new Set(bc.map((r) => (r as { date?: string }).date))].filter(Boolean).sort();

  return NextResponse.json({
    snapshotUploadedAt: snapshot.uploadedAt,
    reportMeta: dataset.reportMeta,
    rowCount: bc.length,
    hasDateField,
    distinctYearMonths,
    distinctDateCount: distinctDates.length,
    distinctDatesSample: distinctDates.slice(-15),
    sample,
  });
}

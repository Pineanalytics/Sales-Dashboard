import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPerformanceSnapshotPayload } from "@/lib/performanceAnalysis/store";

export const runtime = "nodejs";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/** Replaces the stored Performance Analysis report for one calendar year with the SAP job's latest. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON: { "year": 2026, "snapshot": { ... } }.' }, { status: 400 });
  }

  const { year, snapshot } = (body ?? {}) as { year?: unknown; snapshot?: unknown };
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "year must be a whole calendar year." }, { status: 400 });
  }
  if (!isPerformanceSnapshotPayload(snapshot)) {
    return NextResponse.json({ error: "snapshot is not a Performance Analysis report." }, { status: 400 });
  }

  const generatedAt = new Date(snapshot.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) return NextResponse.json({ error: "snapshot.generatedAt is not a date." }, { status: 400 });

  const payload = snapshot as unknown as Prisma.InputJsonValue;
  await prisma.performanceAnalysisSnapshot.upsert({
    where: { year },
    create: { year, generatedAt, asOf: snapshot.asOf, lineCount: snapshot.lineCount, payload },
    update: { generatedAt, asOf: snapshot.asOf, lineCount: snapshot.lineCount, payload },
  });
  return NextResponse.json({ ok: true, year, lineCount: snapshot.lineCount, generatedAt: snapshot.generatedAt });
}

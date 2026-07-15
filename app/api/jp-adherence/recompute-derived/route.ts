import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recomputeRepContribution, recomputeDailyTargets } from "@/lib/repContribution";

export const runtime = "nodejs";

// Triggered by scripts/db-bridge/jp-adherence/run.ts as the final step of the
// sync, after Monthly Split has finished uploading — recomputes Contribution-by-
// Rep and Daily Projection from data that sync just refreshed. No request body:
// this is a signal, not a data upload (unlike the other jp-adherence routes).
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

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  try {
    const contribution = await recomputeRepContribution();
    const daily = await recomputeDailyTargets();
    return NextResponse.json({ contribution, daily }, { status: 200 });
  } catch (err) {
    console.error("Failed to recompute RepContribution/DailyTarget", err);
    return NextResponse.json({ error: "Failed to recompute derived Target data." }, { status: 500 });
  }
}

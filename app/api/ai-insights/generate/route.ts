import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { generateAiInsights } from "@/lib/aiInsights";
import { auth } from "@/auth";

export const runtime = "nodejs";

/** Same shared-secret pattern as /api/upload — scripts/ai-insights-sync.ps1 can't
 *  hold a browser session, so it authenticates with UPLOAD_API_KEY instead. */
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
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin sign-in or a valid API key is required." }, { status: 401 });
    }
  }

  try {
    const insight = await generateAiInsights();
    return NextResponse.json({ insight });
  } catch (err) {
    console.error("Failed to generate AI insights", err);
    const message = err instanceof Error ? err.message : "Failed to generate AI insights.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

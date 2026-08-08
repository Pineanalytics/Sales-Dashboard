import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getRepPerformanceData } from "@/lib/repPerformance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-side feed for Rep Performance's Employee Master identity, RepCall-derived
 *  coverage/productivity, and Target rows — the client merges this with the
 *  existing /api/sales/rep-actuals SAP feed to build the leaderboard. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const year = req.nextUrl.searchParams.get("year")?.trim();
  if (!year) return NextResponse.json({ error: '"year" is required.' }, { status: 400 });

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const data = await getRepPerformanceData(year, scope);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Failed to load rep performance data", err);
    return NextResponse.json({ error: "Failed to load rep performance data." }, { status: 500 });
  }
}

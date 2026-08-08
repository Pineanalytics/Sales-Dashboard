import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getJpAdherenceDetail } from "@/lib/jpAdherence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy drill-down: the rep-day detail (planned vs actual, outlet by outlet) is
// only computed for one rep-day at a time (?date=YYYY-MM-DD&employeeCode=...),
// never the whole month, since a live join over the full plan/RepCall window
// would be needlessly wide for what's just a modal's worth of rows.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const dateParam = req.nextUrl.searchParams.get("date");
  const employeeCode = req.nextUrl.searchParams.get("employeeCode");
  if (!dateParam || !employeeCode) {
    return NextResponse.json({ error: "Both date and employeeCode query params are required." }, { status: 400 });
  }
  const date = new Date(dateParam);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
  if (scope && !scope.employeeCodes.includes(employeeCode)) {
    return NextResponse.json({ error: "That rep isn't on your team." }, { status: 403 });
  }

  try {
    const detail = await getJpAdherenceDetail(date, employeeCode);
    return NextResponse.json({ detail });
  } catch (err) {
    console.error("Failed to load JP Adherence detail", err);
    return NextResponse.json({ error: "Failed to load JP Adherence detail." }, { status: 500 });
  }
}

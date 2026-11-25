import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { SAP_SYNC_JOBS } from "@/lib/syncJobs";
import { getScheduleStates, setScheduledRuns } from "@/lib/syncSchedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

/** The on/off switch for scheduled sync runs on Admin > Data & sync. Body: {"jobs":["stock"],"enabled":false} or
 *  {"group":"sap","enabled":false} for every SAP job at once. The worker notices within about ten seconds. A job that is switched
 *  off keeps its "Refresh now" button; only its scheduled slots are skipped. */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });

  let body: { jobs?: unknown; group?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected {"group":"sap","enabled":false} or {"jobs":["stock"],"enabled":true}.' }, { status: 400 });
  }
  const outcome = await setScheduledRuns(body, user.email ?? user.name ?? null);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ jobs: outcome.jobs, enabled: outcome.enabled });
}

/** Which jobs are switched off right now. */
export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });

  const states = await getScheduleStates();
  const off = [...states.entries()].filter(([, state]) => !state.enabled).map(([job]) => job);
  return NextResponse.json({ off, sapJobs: SAP_SYNC_JOBS });
}

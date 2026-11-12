import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isSyncJobName } from "@/lib/syncJobs";
import { requestSyncRun, SYNC_REQUEST_UNCLAIMED_AFTER_MS } from "@/lib/syncRunRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

/** "Refresh now" on Admin > Data & sync. Queues the job for the worker that owns it; the worker picks it up
 *  within seconds and runs it ahead of its next slot. A job already queued or running is not queued twice. */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });

  let body: { job?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected {"job":"sales"}.' }, { status: 400 });
  }
  const outcome = await requestSyncRun(body.job, user.email ?? user.name ?? null);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ request: outcome.request, alreadyActive: outcome.alreadyActive }, { status: outcome.alreadyActive ? 200 : 202 });
}

/** Progress of the newest request for one job, polled by the button after a click. */
export async function GET(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });

  const job = request.nextUrl.searchParams.get("job");
  if (!isSyncJobName(job)) return NextResponse.json({ error: '"job" must be a known sync job.' }, { status: 400 });
  const latest = await prisma.syncRunRequest.findFirst({ where: { job }, orderBy: { requestedAt: "desc" } });
  if (!latest) return NextResponse.json({ request: null });
  const unclaimed = latest.status === "PENDING" && Date.now() - latest.requestedAt.getTime() > SYNC_REQUEST_UNCLAIMED_AFTER_MS;
  return NextResponse.json({ request: latest, unclaimed });
}

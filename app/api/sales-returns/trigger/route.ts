import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const VALID_WINDOWS = new Set(["today", "yesterday", "catchup"]);

/**
 * Queues a manual "run the sync now" request for one Sales & Returns branch —
 * the Centegy machines (Nairobi, Nyeri) are on isolated networks with no
 * inbound access, so nothing can reach in and trigger them directly. Each
 * machine's own scheduled poll picks this up instead (see
 * scripts/sales-returns-trigger-poll.ps1 and GET .../trigger/pending).
 * Session-authed, ADMIN only — this queues a real SQL Server pull + upload,
 * not a read.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  let body: { distributor?: unknown; window?: unknown; backfillFrom?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "distributor" and either "window" or "backfillFrom".' }, { status: 400 });
  }

  if (typeof body.distributor !== "string" || !body.distributor) {
    return NextResponse.json({ error: '"distributor" is required.' }, { status: 400 });
  }

  const hasWindow = body.window !== undefined && body.window !== null;
  const hasBackfill = body.backfillFrom !== undefined && body.backfillFrom !== null;
  if (hasWindow === hasBackfill) {
    return NextResponse.json({ error: 'Provide exactly one of "window" or "backfillFrom".' }, { status: 400 });
  }

  let window: string | null = null;
  let backfillFrom: Date | null = null;
  if (hasWindow) {
    if (typeof body.window !== "string" || !VALID_WINDOWS.has(body.window)) {
      return NextResponse.json({ error: '"window" must be "today", "yesterday", or "catchup".' }, { status: 400 });
    }
    window = body.window;
  } else {
    if (typeof body.backfillFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.backfillFrom)) {
      return NextResponse.json({ error: '"backfillFrom" must be a YYYY-MM-DD date.' }, { status: 400 });
    }
    backfillFrom = new Date(`${body.backfillFrom}T00:00:00.000Z`);
    if (Number.isNaN(backfillFrom.getTime())) {
      return NextResponse.json({ error: '"backfillFrom" is not a valid date.' }, { status: 400 });
    }
    if (backfillFrom.toISOString().slice(0, 10) !== body.backfillFrom) {
      return NextResponse.json({ error: '"backfillFrom" must be a real calendar date.' }, { status: 400 });
    }
  }

  if (backfillFrom) {
    const control = await prisma.salesReturnsControl.findUnique({
      where: { distributor: body.distributor },
      select: { desiredMode: true },
    });
    if (control?.desiredMode === "CATCHUP") {
      return NextResponse.json(
        { error: "Historical repair is stopped for this branch. Resume Smart repair before queuing a selected-day repair." },
        { status: 409 }
      );
    }
  }

  // Avoid stacking up duplicate requests if the button gets clicked more than
  // once before the branch machine has a chance to poll — return the
  // existing one instead of creating a new one.
  const existing = await prisma.salesReturnsTriggerRequest.findFirst({
    where: { distributor: body.distributor, status: { in: ["PENDING", "CLAIMED"] } },
    orderBy: { requestedAt: "desc" },
  });
  if (existing) return NextResponse.json({ request: existing, alreadyQueued: true });

  const request = await prisma.salesReturnsTriggerRequest.create({
    data: { distributor: body.distributor, window, backfillFrom, requestedBy: session.user.email ?? null },
  });
  return NextResponse.json({ request, alreadyQueued: false });
}

/** Recent requests for one branch, newest first — powers the Sync Health
 *  panel's "queued / running / last trigger result" display. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  }

  const distributor = new URL(req.url).searchParams.get("distributor");
  if (!distributor) return NextResponse.json({ error: '"distributor" query param is required.' }, { status: 400 });

  const requests = await prisma.salesReturnsTriggerRequest.findMany({
    where: { distributor },
    orderBy: { requestedAt: "desc" },
    take: 5,
  });
  return NextResponse.json({ requests });
}

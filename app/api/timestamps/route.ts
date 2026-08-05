import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { fetchAllInChunks } from "@/lib/prismaPagination";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentMonthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function parseFrom(req: NextRequest, monthStart: Date, monthEnd: Date): Date | NextResponse {
  const raw = req.nextUrl.searchParams.get("from");
  if (!raw) return monthStart;
  const requested = new Date(raw);
  if (Number.isNaN(requested.getTime())) {
    return NextResponse.json({ error: '"from" must be a valid ISO date string.' }, { status: 400 });
  }
  if (requested >= monthEnd) return requested;
  return requested < monthStart ? monthStart : requested;
}

/** Current-month Timestamps. Supplying `?from=` requests just a replacement
 * window; the client uses that after a new five-minute sync rather than
 * re-downloading the entire month's call detail. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const { start: monthStart, end: monthEnd } = currentMonthWindow(new Date());
    const from = parseFrom(req, monthStart, monthEnd);
    if (from instanceof NextResponse) return from;

    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals);
    const where = {
      date: { gte: from, lt: monthEnd },
      ...(scope ? { employeeCode: { in: scope.employeeCodes } } : {}),
    };
    // Ordered by id (the indexed primary key) - the page re-sorts client-side,
    // and date/employeeCode/callSequence is not fully covered by an index.
    const [calls, watermark] = await Promise.all([
      fetchAllInChunks((page) => prisma.repCall.findMany({ where, orderBy: { id: "asc" }, ...page })),
      prisma.syncWatermark.findUnique({ where: { bridge: "timestamps" }, select: { updatedAt: true } }),
    ]);
    return NextResponse.json({
      calls,
      from: from.toISOString(),
      syncUpdatedAt: watermark?.updatedAt.toISOString() ?? null,
    });
  } catch (err) {
    console.error("Failed to load Timestamps data", err);
    return NextResponse.json({ error: "Failed to load Timestamps data." }, { status: 500 });
  }
}

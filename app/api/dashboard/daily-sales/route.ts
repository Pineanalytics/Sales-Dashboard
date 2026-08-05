import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only feed for the Executive Overview's Week 1-4/Daily Projection cards —
 *  reads DailySalesActual directly (see scripts/db-bridge/sales-sync.ts for how it's
 *  populated). ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive), &principal= optional. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const principal = searchParams.get("principal");
  if (!from || !to) {
    return NextResponse.json({ error: "\"from\" and \"to\" (YYYY-MM-DD) are required." }, { status: 400 });
  }

  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals);
  if (scope && principal && !scope.principals.includes(principal)) {
    return NextResponse.json({ error: "That principal isn't one of your assigned principals." }, { status: 403 });
  }

  const rows = await prisma.dailySalesActual.findMany({
    where: {
      date: { gte: new Date(from), lte: new Date(to) },
      ...(principal ? { principal } : scope ? { principal: { in: scope.principals } } : {}),
    },
    select: { date: true, principal: true, revenue: true, cogs: true, grossProfit: true },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ rows });
}

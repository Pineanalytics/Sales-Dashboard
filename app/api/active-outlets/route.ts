import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { fetchAllInChunks } from "@/lib/prismaPagination";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId);
    const principalWhere = scope ? { principal: { in: scope.principals } } : {};
    const [outlets, monthly] = await Promise.all([
      // Ordered by id (the indexed primary key), not principal/outletName — the page
      // re-sorts everything client-side anyway, and an unindexed sort column would
      // force Postgres to re-sort the whole table on every chunk, defeating the point.
      fetchAllInChunks((page) => prisma.activeOutlet.findMany({ where: principalWhere, orderBy: { id: "asc" }, ...page })),
      prisma.activeOutletMonthly.findMany({ where: principalWhere, orderBy: [{ monthIndex: "asc" }, { principal: "asc" }] }),
    ]);
    return NextResponse.json({ outlets, monthly });
  } catch (err) {
    console.error("Failed to load Active Outlets data", err);
    return NextResponse.json({ error: "Failed to load Active Outlets data." }, { status: 500 });
  }
}

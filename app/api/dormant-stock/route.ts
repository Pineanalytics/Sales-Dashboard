import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const where = scope ? { principal: { in: scope.principals } } : {};
    const [items, latestRun] = await Promise.all([
      prisma.dormantStockActual.findMany({ where, orderBy: [{ principal: "asc" }, { item: "asc" }] }),
      prisma.stockSyncRun.findFirst({ orderBy: { completedAt: "desc" }, select: { completedAt: true, sourceDate: true } }),
    ]);
    return NextResponse.json({ items, completedAt: latestRun?.completedAt ?? null, sourceDate: latestRun?.sourceDate ?? null });
  } catch (error) {
    console.error("Failed to load dormant out-of-stock items", error);
    return NextResponse.json({ error: "Failed to load dormant out-of-stock items." }, { status: 500 });
  }
}

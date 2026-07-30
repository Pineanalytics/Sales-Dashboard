import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentRefreshWindow(now: Date): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86400000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return yesterday < monthStart ? monthStart : yesterday;
}

/** A deliberately tiny authenticated endpoint for the open report's polling
 * loop. It exposes only the completion revision and replacement window, not
 * sales activity, so the page only requests changed call rows after a sync. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const watermark = await prisma.syncWatermark.findUnique({ where: { bridge: "timestamps" }, select: { updatedAt: true } });
    return NextResponse.json({
      syncUpdatedAt: watermark?.updatedAt.toISOString() ?? null,
      refreshFrom: currentRefreshWindow(new Date()).toISOString(),
    });
  } catch (err) {
    console.error("Failed to load Timestamps status", err);
    return NextResponse.json({ error: "Failed to load Timestamps status." }, { status: 500 });
  }
}

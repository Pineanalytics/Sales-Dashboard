import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { getActiveUniverseStatus } from "@/lib/outletUniverse/query";
import { refreshOutletUniverseIfStale } from "@/lib/outletUniverse/rebuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_AFTER_MS = 30 * 60_000;

/** The current active universe for the Executive Summary tile: every principal (or the
 *  selected principal brand), split Primary / Secondary into actively buying, buying at
 *  least twice a month, and dormant. Scoped to the caller's own principals. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const principalKey = (req.nextUrl.searchParams.get("principalKey") ?? "").trim().slice(0, 80) || null;
    const status = await getActiveUniverseStatus(access.scope, principalKey);
    void refreshOutletUniverseIfStale(REFRESH_AFTER_MS).catch((error) => console.error("Active Outlet freshness check failed", error));
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load the active universe status", error);
    return NextResponse.json({ error: "Failed to load the active universe." }, { status: 500 });
  }
}

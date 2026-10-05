import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { getOutletUniverseSummary, listOutlets, parseOutletFilters } from "@/lib/outletUniverse/query";
import { isOutletUniverseRebuilding, refreshOutletUniverseIfStale } from "@/lib/outletUniverse/rebuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_AFTER_MS = 30 * 60_000;

/** Dashboard aggregates plus one page of the outlet list, for the same filters. */
export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });

  try {
    const filters = parseOutletFilters(req.nextUrl.searchParams);
    const page = Math.floor(Number(req.nextUrl.searchParams.get("page"))) || 1;
    const [summary, list] = await Promise.all([getOutletUniverseSummary(filters, access.scope), listOutlets(filters, access.scope, page)]);
    // Keep the universe fresh without a scheduler: a stale or empty one is
    // recompiled in the background while this request is answered from the current copy.
    void refreshOutletUniverseIfStale(REFRESH_AFTER_MS).catch((error) => console.error("Active Outlet freshness check failed", error));
    return NextResponse.json(
      { filters, summary, list, canRefresh: access.isAdmin, rebuilding: isOutletUniverseRebuilding() },
      { headers: { "Server-Timing": `outlet-universe;dur=${(performance.now() - startedAt).toFixed(1)}`, "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Failed to load the Active Outlet universe", error);
    return NextResponse.json({ error: "Failed to load Active Outlet data." }, { status: 500 });
  }
}

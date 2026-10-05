import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rebuildOutletUniverse } from "@/lib/outletUniverse/rebuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Recompiles the unified outlet universe from Pine, Leverage and EABL DMS on
 *  demand (admin only). Normally it refreshes itself in the background; this is
 *  the "Refresh now" button. A rebuild already in flight is joined, not repeated. */
export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  try {
    return NextResponse.json(await rebuildOutletUniverse());
  } catch (error) {
    console.error("Failed to rebuild the Active Outlet universe", error);
    return NextResponse.json({ error: "Failed to rebuild the Active Outlet universe." }, { status: 500 });
  }
}

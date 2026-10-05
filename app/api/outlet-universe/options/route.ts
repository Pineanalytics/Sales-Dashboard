import { NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { getOutletFilterOptions } from "@/lib/outletUniverse/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The values each Active Outlet filter can take, within the caller's own scope. */
export async function GET() {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    return NextResponse.json(await getOutletFilterOptions(access.scope), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load Active Outlet filter options", error);
    return NextResponse.json({ error: "Failed to load filter options." }, { status: 500 });
  }
}

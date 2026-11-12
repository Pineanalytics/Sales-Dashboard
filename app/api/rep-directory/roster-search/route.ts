import { NextRequest, NextResponse } from "next/server";
import { getRosterActor, searchRosterEmployees } from "@/lib/repLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roster employees for the directory page's picker for Leverage, DataEdge and EABL identities: matches for typed text, and, given the
 *  identity's name, the employees whose name looks like it. Admin only. */
export async function GET(request: NextRequest) {
  const actor = await getRosterActor();
  if (!actor?.isAdmin) return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const identityName = request.nextUrl.searchParams.get("identityName");
  return NextResponse.json(await searchRosterEmployees(q, identityName ? identityName.slice(0, 120) : null));
}

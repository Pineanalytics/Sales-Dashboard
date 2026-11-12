import { NextRequest, NextResponse } from "next/server";
import { REP_SOURCES, type RepSource } from "@/lib/repDirectoryBuild";
import { getRosterActor, searchIdentities } from "@/lib/repLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Type-ahead over the rep directory for the roster's inline link cells. Roster editors only (admins, and team leaders for SAP and Pine). */
export async function GET(request: NextRequest) {
  const actor = await getRosterActor();
  if (!actor) return NextResponse.json({ error: "Sign in as an admin or team leader." }, { status: 401 });
  const source = request.nextUrl.searchParams.get("source");
  if (!source || !(REP_SOURCES as readonly string[]).includes(source)) return NextResponse.json({ error: '"source" must be a known rep source.' }, { status: 400 });
  if (!actor.isAdmin && source !== "SAP" && source !== "PINE") return NextResponse.json({ error: "Only admins can search that source." }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const hits = await searchIdentities(source as RepSource, q.slice(0, 80));
  return NextResponse.json({ hits });
}

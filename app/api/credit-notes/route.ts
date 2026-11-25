import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { creditNotesAccessFor, lineScopeFrom } from "@/lib/creditNotes/scope";
import { parseCreditNotesParams } from "@/lib/creditNotes/request";
import { buildCreditNotesReport } from "@/lib/creditNotes/store";
import type { CreditNotesResponse } from "@/lib/creditNotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Credit Notes & Returns report for the dashboard's period and principal filter.
 *  GET ?months=2026-07,2026-08&principals=mars,eabl&q=optional search
 *  `principals` uses the dashboard's normalised principal keys; an empty list is every principal the login may see.
 *  Team Leaders, Supervisors and principal-restricted logins are cut to their own scope on the server. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const access = await creditNotesAccessFor(session.user);
  if (!access.ok) return NextResponse.json({ error: "Credit Notes & Returns access required." }, { status: 403 });

  const parsed = parseCreditNotesParams(req.nextUrl.searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const scope = lineScopeFrom(access.scope);
    const { meta, report } = await buildCreditNotesReport({ ...parsed.value, scope });
    const body: CreditNotesResponse = { meta, report, scoped: scope !== null };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to build the Credit Notes & Returns report", error);
    return NextResponse.json({ error: "Failed to build the report." }, { status: 500 });
  }
}

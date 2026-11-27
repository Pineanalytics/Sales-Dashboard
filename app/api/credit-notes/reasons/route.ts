import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { creditNotesAccessFor, lineScopeFrom } from "@/lib/creditNotes/scope";
import { parseCreditNotesParams } from "@/lib/creditNotes/request";
import { buildCreditNoteReasons } from "@/lib/creditNotes/reasonsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Why credit notes were issued, for the same filter as /api/credit-notes.
 *  GET ?months=2026-07,2026-08&principals=mars,eabl&q=optional search */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const access = await creditNotesAccessFor(session.user);
  if (!access.ok) return NextResponse.json({ error: "Credit Notes & Returns access required." }, { status: 403 });

  const parsed = parseCreditNotesParams(req.nextUrl.searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const scope = lineScopeFrom(access.scope);
    const result = await buildCreditNoteReasons({ ...parsed.value, scope });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to build the credit-note reasons", error);
    return NextResponse.json({ error: "Failed to build the reasons report." }, { status: 500 });
  }
}

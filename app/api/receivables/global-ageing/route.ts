import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGlobalAgeingReport } from "@/lib/globalAgeing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazily fetched by the Global Ageing tab (components/financials/GlobalAgeingTab.tsx)
// rather than embedded in the Financials page's initial server payload — the
// customer-detail rows run into the thousands, and every other Financials tab
// would otherwise pay for that on every page load.
export async function GET() {
  const session = await auth();
  const canView = session?.user && (session.user.role === "ADMIN" || (session.user.allowedPages ?? []).includes("receivables"));
  if (!canView) return NextResponse.json({ error: "You do not have access to Receivables." }, { status: 403 });

  const report = await getGlobalAgeingReport();
  if (!report) return NextResponse.json({ error: "Receivables have not synced yet." }, { status: 404 });
  return NextResponse.json(report);
}

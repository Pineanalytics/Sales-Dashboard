import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGlobalAgeingReport, parseGlobalAgeingFilters, toSummary } from "@/lib/globalAgeing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazily fetched by the Global Ageing tab (components/financials/GlobalAgeingTab.tsx)
// rather than embedded in the Financials page's initial server payload. It returns the
// summary only (the per-Principal pivot and totals): the customer and cheque rows, which
// run into the thousands, are in the Excel report (./export). Filters: ?principal=A&principal=B
// and a period as ?month=2026-09 or ?from=2026-09-01&to=2026-09-30.
export async function GET(request: NextRequest) {
  const session = await auth();
  const canView = session?.user && (session.user.role === "ADMIN" || (session.user.allowedPages ?? []).includes("receivables"));
  if (!canView) return NextResponse.json({ error: "You do not have access to Receivables." }, { status: 403 });

  const { filters, error } = parseGlobalAgeingFilters(request.nextUrl.searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const report = await getGlobalAgeingReport(filters);
  if (!report) return NextResponse.json({ error: "Receivables have not synced yet." }, { status: 404 });
  return NextResponse.json(toSummary(report));
}

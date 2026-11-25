import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";
import { creditNotesAccessFor, lineScopeFrom } from "@/lib/creditNotes/scope";
import { parseCreditNotesParams } from "@/lib/creditNotes/request";
import { buildCreditNotesReport } from "@/lib/creditNotes/store";
import { buildCreditNotesSheets } from "@/lib/creditNotes/workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function label(params: URLSearchParams, name: string, fallback: string): string {
  return (params.get(name) ?? "").trim().slice(0, 160) || fallback;
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "all";
}

/** The Credit Notes & Returns report as an Excel workbook, for exactly the filter the page is showing.
 *  GET ?months=...&principals=...&q=...&label=Q3 2026&principalLabel=Mars, EABL
 *  `label` and `principalLabel` are display text only; the filters themselves are `months`, `principals` and `q`. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const access = await creditNotesAccessFor(session.user);
  if (!access.ok) return NextResponse.json({ error: "Credit Notes & Returns access required." }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const parsed = parseCreditNotesParams(params);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { months, principalKeys, query } = parsed.value;

  try {
    const scope = lineScopeFrom(access.scope);
    const { meta, report } = await buildCreditNotesReport({ months, principalKeys, query, scope, full: true });
    if (!meta || !report || report.kpi.creditLines === 0) {
      return NextResponse.json({ error: meta ? "No credit notes were recorded for this selection." : "The SAP lines have not been built yet." }, { status: 404 });
    }
    const periodLabel = label(params, "label", months.length === 1 ? months[0] : `${months[0]} to ${months[months.length - 1]}`);
    const principalLabel = label(params, "principalLabel", principalKeys.length === 0 ? "All principals" : principalKeys.join(", "));
    const generatedAt = new Date();
    const body = extractToXlsxBuffer(buildCreditNotesSheets(report, meta, { periodLabel, principalLabel, query, generatedAt, scoped: scope !== null }));
    const filename = `credit-notes-returns-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to build the Credit Notes & Returns export", error);
    return NextResponse.json({ error: "Failed to build the export." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { parseAnalysisParams } from "@/lib/universeAnalysis/params";
import { getAnalysisContext } from "@/lib/universeAnalysis/service";
import { buildWorkbook } from "@/lib/universeAnalysis/workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The whole analysis (every section) for one month as an Excel workbook, narrowed by the same filters as the screen. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const parsed = parseAnalysisParams(req.nextUrl.searchParams);
    const ctx = await getAnalysisContext(access.scope, parsed.month);
    const buffer = buildWorkbook(ctx, parsed.section_params);
    const stamp = `${ctx.year}-${String(ctx.monthIndex + 1).padStart(2, "0")}`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="universe-analysis-${stamp}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export the universe analysis", error);
    return NextResponse.json({ error: "Failed to export the universe analysis." }, { status: 500 });
  }
}

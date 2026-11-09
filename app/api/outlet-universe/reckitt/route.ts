import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { oneAtATime } from "@/lib/outletUniverse/exportQueue";
import { parseOutletFilters } from "@/lib/outletUniverse/query";
import { buildReckittSummary, loadReckittReport } from "@/lib/outletUniverse/reckitt";
import { reckittCsv, reckittFileStem, reckittWorkbook } from "@/lib/outletUniverse/reckittExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Reckitt universe: every shop that bought in the last six calendar months, with its buying tenure (Once in 6 Months, Once in 3 Months, Once Per Month), Direct or
 *  Indirect, and whether it is selected for Reckitt. As an Excel workbook (summary + raw rows + definitions, format=xlsx, the default), the raw rows as CSV (format=csv)
 *  or the summary as JSON (format=json). Always the whole universe within the session's own principals: the Active Outlets filters on screen do not narrow it. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const format = req.nextUrl.searchParams.get("format");
    const filters = parseOutletFilters(new URLSearchParams());
    const noStore = { "Cache-Control": "private, no-store" };
    if (format !== "json" && format !== "csv") {
      // The Excel build is the heavy part, so it is queued with the load.
      return await oneAtATime(async () => {
        const report = await loadReckittReport(filters, access.scope);
        return new NextResponse(new Uint8Array(reckittWorkbook(report)), {
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${reckittFileStem(report)}.xlsx"`, ...noStore },
        });
      });
    }
    const report = await oneAtATime(() => loadReckittReport(filters, access.scope));
    if (format === "csv") {
      return new NextResponse(`﻿${reckittCsv(report)}`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${reckittFileStem(report)}.csv"`, ...noStore },
      });
    }
    const active = report.outlets.filter((o) => o.active).length;
    return NextResponse.json(
      {
        window: report.window.label,
        outletCount: report.outlets.length,
        activeCount: active,
        selectedCount: report.outlets.filter((o) => o.selected).length,
        systemOutlets: report.systemOutlets,
        duplicatesMerged: report.duplicatesMerged,
        summary: buildReckittSummary(report.outlets),
        generatedAt: report.generatedAt,
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error("Failed to build the Reckitt universe", error);
    return NextResponse.json({ error: "Failed to build the Reckitt universe." }, { status: 500 });
  }
}

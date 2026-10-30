import { NextRequest, NextResponse } from "next/server";
import { resolveCleanupActor } from "@/lib/outletCleanup/access";
import { countQueue, listQueueReport, loadReportOptions, parseQueueFilters } from "@/lib/outletCleanup/data";
import { reportCsv, reportFileStem, reportWorkbook } from "@/lib/outletCleanup/reportExport";
import { oneAtATime } from "@/lib/outletUniverse/exportQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Outlet Cleanup report extract: every outlet the signed-in person works on that the filters match (status, activity, rep, territory, region, principal, team leader, search),
 *  as an Excel workbook (format=xlsx, the default) or CSV (format=csv). format=count says how many outlets that is, and format=options lists the principals, regions and team leaders to narrow by. */
export async function GET(req: NextRequest) {
  const access = await resolveCleanupActor();
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? "Sign in required." : "The outlet cleanup is for team leaders and supervisors." }, { status: access.status });
  const noStore = { "Cache-Control": "private, no-store" };
  try {
    const params = req.nextUrl.searchParams;
    const format = params.get("format");
    if (format === "options") return NextResponse.json(await loadReportOptions(access.actor), { headers: noStore });
    const filters = parseQueueFilters(params);
    if (format === "count") return NextResponse.json({ total: await countQueue(access.actor, filters) }, { headers: noStore });

    // The extract can hold every outlet of the company for an admin, so it is built one at a time with the other big extracts.
    return await oneAtATime(async () => {
      const rows = await listQueueReport(access.actor, filters);
      const stem = reportFileStem();
      if (format === "csv") {
        return new NextResponse(`﻿${reportCsv(rows)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"`, ...noStore } });
      }
      const applied = [
        `Status: ${filters.state}`,
        `Buying: ${filters.activity === "all" ? "active and dormant" : filters.activity}`,
        ...(filters.rep ? [`Rep: ${filters.rep}`] : []),
        ...(filters.territory ? [`Territory: ${filters.territory}`] : []),
        ...(filters.region ? [`Region: ${filters.region}`] : []),
        ...(filters.principal ? [`Principal: ${filters.principal}`] : []),
        ...(filters.teamLeader ? [`Team leader: ${filters.teamLeader}`] : []),
        ...(filters.q ? [`Search: ${filters.q}`] : []),
      ];
      const book = reportWorkbook(rows, { generatedAt: new Date(), generatedBy: access.actor.email, filters: applied });
      return new NextResponse(new Uint8Array(book), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${stem}.xlsx"`, ...noStore },
      });
    });
  } catch (error) {
    console.error("Failed to build the outlet cleanup report", error);
    return NextResponse.json({ error: "Failed to build the report." }, { status: 500 });
  }
}

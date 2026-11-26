import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildRepSalesWorkbook, type RepSalesDownload } from "@/lib/coachingRepSalesExcel";
import { loadRepSales } from "@/lib/coachingRepSalesQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rep sales as the Coaching app shows them, as Excel: ?download=summary (a row per rep) or outlets (a row per rep and outlet), with the page's filters. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Sign in again.", { status: 401 });
  const params = request.nextUrl.searchParams;
  const download: RepSalesDownload = params.get("download") === "outlets" ? "outlets" : "summary";

  let result;
  try {
    result = await loadRepSales(session.user, {
      month: params.get("month"), leader: params.get("leader"), principal: params.get("principal"), rep: params.get("rep"), q: params.get("q"),
    });
  } catch (error) {
    console.error("Rep sales extract failed", error);
    return new NextResponse("The rep sales could not be loaded. Try again.", { status: 502 });
  }
  if (!result) return new NextResponse("You do not have Coaching access.", { status: 403 });

  const buffer = await buildRepSalesWorkbook(result.report, download);
  const part = [result.filters.teamLeader, result.filters.principal, result.filters.repCode].filter(Boolean).join("_").replace(/[^a-z0-9]+/gi, "_");
  const filename = `Rep_sales_${download === "outlets" ? "outlet_detail" : "summary"}_${result.filters.month}${part ? `_${part}` : ""}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildDsrExtractSheets, fetchDsrExtractData, parseDsrExtractParams } from "@/lib/eablDsrExtract";
import { extractToXlsxBuffer } from "@/lib/extractWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The full EABL DSR extract as one Excel workbook: ?start=yyyy-mm-dd&end=yyyy-mm-dd, and &salesman=Name for one salesman. Open to the same
// users as the DSR Review itself (the Timestamps report, or an admin).
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (session.user.role !== "ADMIN" && !session.user.allowedPages?.includes("timestamps")) {
    return NextResponse.json({ error: "You don't have access to EABL DSR Review." }, { status: 403 });
  }

  const { params, error } = parseDsrExtractParams(request.nextUrl.searchParams);
  if (!params) return NextResponse.json({ error }, { status: 400 });

  try {
    const data = await fetchDsrExtractData(params);
    const sheets = buildDsrExtractSheets(data, { params, generatedAt: new Date() });
    const buffer = extractToXlsxBuffer(sheets);
    const who = params.salesman ? `-${params.salesman.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="eabl-dsr-${params.start}-to-${params.end}${who}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (cause) {
    console.error("Failed to build the EABL DSR extract", cause);
    return NextResponse.json({ error: "The DSR service could not be read, so the extract was not built. Try again in a moment." }, { status: 502 });
  }
}

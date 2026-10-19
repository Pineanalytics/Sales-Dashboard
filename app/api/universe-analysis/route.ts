import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { parseAnalysisParams } from "@/lib/universeAnalysis/params";
import { buildSection, getAnalysisContext } from "@/lib/universeAnalysis/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "\uFEFF\r\n";
  const headers = Object.keys(rows[0]);
  return "\uFEFF" + [headers.map(csvCell).join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";
}

/** The analysis of one month of the Active Outlets universe, by section. Every section takes the same filters (repeat a parameter to select several values). */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const params = req.nextUrl.searchParams;
    const parsed = parseAnalysisParams(params);
    const section = parsed.section;
    const ctx = await getAnalysisContext(access.scope, parsed.month);
    const data = buildSection(ctx, section, parsed.section_params);
    if (params.get("format") === "csv") {
      const d = data as { rows?: Record<string, unknown>[]; pairs?: Record<string, unknown>[]; records?: Record<string, unknown>[] };
      const list = d.rows ?? d.pairs ?? d.records;
      if (!list) return NextResponse.json({ error: "This section has no list to download." }, { status: 400 });
      return new NextResponse(toCsv(list), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="universe-analysis-${section}-${ctx.year}-${String(ctx.monthIndex + 1).padStart(2, "0")}.csv"`, "Cache-Control": "private, no-store" },
      });
    }
    // NaN and Infinity (a share over nothing) are not JSON: send them as null.
    const body = JSON.stringify(data, (_key, value) => (typeof value === "number" && !Number.isFinite(value) ? null : value));
    return new NextResponse(body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to build the universe analysis", error);
    return NextResponse.json({ error: "Failed to build the universe analysis." }, { status: 500 });
  }
}

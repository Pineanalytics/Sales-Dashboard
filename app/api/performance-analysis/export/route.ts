import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { performanceAccessFor } from "@/lib/performanceAnalysis/access";
import { buildPerformanceExportData } from "@/lib/performanceAnalysis/store";
import { buildPerformanceWorkbook } from "@/lib/performanceAnalysis/workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function label(params: URLSearchParams, name: string, fallback: string): string {
  return (params.get(name) ?? "").trim().slice(0, 160) || fallback;
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "all";
}

/** The whole Performance Analysis as a formatted Excel workbook, for the period and principals the page is showing.
 *  GET ?months=2026-07,2026-08&principals=mars,eabl&label=Q3 2026&principalLabel=Mars, EABL
 *  `label` and `principalLabel` are display text only; the filters themselves are `months` and `principals`. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const access = await performanceAccessFor(session.user);
  if (access === "denied") return NextResponse.json({ error: "Performance Analysis access required." }, { status: 403 });
  if (access === "restricted") return NextResponse.json({ error: "Not available for restricted accounts." }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const months = (params.get("months") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (months.length === 0 || months.length > 24 || !months.every((month) => MONTH_PATTERN.test(month))) {
    return NextResponse.json({ error: "months must be 1-24 comma-separated YYYY-MM values." }, { status: 400 });
  }
  const principalKeys = (params.get("principals") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (principalKeys.length > 60 || principalKeys.some((key) => key.length > 80)) return NextResponse.json({ error: "Too many principals." }, { status: 400 });

  try {
    const { meta, report, detail } = await buildPerformanceExportData({ months, principalKeys });
    if (!meta || !report || !detail || report.kpi.lines === 0) {
      return NextResponse.json({ error: meta ? "No SAP sales were recorded for this period and principal selection." : "The performance report has not been built yet." }, { status: 404 });
    }
    const periodLabel = label(params, "label", months.length === 1 ? months[0] : `${months[0]} to ${months[months.length - 1]}`);
    const principalLabel = label(params, "principalLabel", principalKeys.length === 0 ? "All principals" : principalKeys.join(", "));
    const generatedAt = new Date();
    const body = await buildPerformanceWorkbook({ payload: report, detail, meta, periodLabel, principalLabel, generatedAt });
    const filename = `performance-analysis-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to build the Performance Analysis export", error);
    return NextResponse.json({ error: "Failed to build the export." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildPurchaseReport } from "@/lib/purchaseReceipts/store";
import { buildPurchaseWorkbook } from "@/lib/purchaseReceipts/workbook";
import type { MonthRef } from "@/lib/purchaseReceipts/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Purchases & Stock Receipts report for the Reports page. `format=json` returns the summary the on-screen report and the PDF are built from;
// the default returns the full Excel workbook. Same access as the Stock & Operations page.

function periods(request: NextRequest): MonthRef[] {
  return request.nextUrl.searchParams.getAll("period").flatMap((value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    return match ? [{ year: Number(match[1]), monthIndex: Number(match[2]) - 1 }] : [];
  });
}

const label = (request: NextRequest, name: string, fallback: string): string => (request.nextUrl.searchParams.get(name) ?? "").trim().slice(0, 120) || fallback;
const fileSlug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "all";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.user.role !== "ADMIN" && !(session.user.allowedPages ?? []).includes("stock")) {
    return NextResponse.json({ error: "You do not have access to Stock & Operations." }, { status: 403 });
  }
  const months = periods(request);
  if (months.length === 0) return NextResponse.json({ error: "Provide a selected period." }, { status: 400 });
  if (months.length > 24) return NextResponse.json({ error: "Choose at most 24 months." }, { status: 400 });
  const principalKey = (request.nextUrl.searchParams.get("principal") ?? "").trim().toLowerCase() || null;

  try {
    const report = await buildPurchaseReport(months, principalKey);
    if (request.nextUrl.searchParams.get("format") === "json") {
      return NextResponse.json({ summary: report.summary, missingMonths: report.missingMonths, syncedAt: report.syncedAt }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const periodLabel = label(request, "label", "Selected period");
    const principalLabel = label(request, "principalLabel", "All principals");
    const buffer = await buildPurchaseWorkbook({ summary: report.summary, lines: report.lines, missingMonths: report.missingMonths, syncedAt: report.syncedAt, periodLabel, principalLabel, generatedAt: new Date() });
    const filename = `purchases-${fileSlug(principalLabel)}-${fileSlug(periodLabel)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to build the purchases report", error);
    return NextResponse.json({ error: "Failed to build the purchases report." }, { status: 500 });
  }
}

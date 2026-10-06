import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { performanceAccessFor } from "@/lib/performanceAnalysis/access";
import { buildPerformanceReport } from "@/lib/performanceAnalysis/store";
import type { GpBasis } from "@/lib/performanceAnalysis/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The Performance Analysis report for a period and principal selection.
 *  GET ?months=2026-07,2026-08,2026-09&principals=mars,eabl&basis=dashboard|recorded
 *  `principals` is optional (all principals); keys are the dashboard's normalised principal keys. */
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
  const basis: GpBasis = params.get("basis") === "recorded" ? "recorded" : "dashboard";

  try {
    const response = await buildPerformanceReport({ months, principalKeys, basis });
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to build the Performance Analysis report", error);
    return NextResponse.json({ error: "Failed to build the report." }, { status: 500 });
  }
}

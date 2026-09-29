import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTimeInTradeTrend, type TimeInTradeRoleFilter } from "@/lib/timeInTrade";
import type { PeriodKind, PeriodSelection } from "@/lib/timeIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS: PeriodKind[] = ["MTD", "MONTH", "QTD", "YTD", "H1", "H2", "Q1", "Q2", "Q3", "Q4", "CUSTOM"];
const VALID_ROLES: TimeInTradeRoleFilter[] = ["all", "Primary Sales", "Secondary Sales"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const kind = request.nextUrl.searchParams.get("kind");
  if (!kind || !(VALID_KINDS as string[]).includes(kind)) {
    return NextResponse.json({ error: '"kind" must be a valid period kind.' }, { status: 400 });
  }
  const year = request.nextUrl.searchParams.get("year");
  if (!year) return NextResponse.json({ error: '"year" is required.' }, { status: 400 });
  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  const toYear = request.nextUrl.searchParams.get("toYear") ?? undefined;
  const toMonth = request.nextUrl.searchParams.get("toMonth") ?? undefined;
  const role = request.nextUrl.searchParams.get("role") ?? "all";
  if (!(VALID_ROLES as string[]).includes(role)) {
    return NextResponse.json({ error: '"role" must be all, Primary Sales, or Secondary Sales.' }, { status: 400 });
  }

  const period: PeriodSelection = { kind: kind as PeriodKind, year, month, toYear, toMonth };

  try {
    const trend = await getTimeInTradeTrend(period, role as TimeInTradeRoleFilter);
    return NextResponse.json(trend);
  } catch (error) {
    console.error("Failed to load Time in Trade trend", error);
    return NextResponse.json({ error: "Failed to load Time in Trade trend." }, { status: 500 });
  }
}

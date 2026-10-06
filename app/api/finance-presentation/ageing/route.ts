import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAgeingSnapshotForMonth } from "@/lib/receivablesAgeing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receivables ageing for the Finance Presentation's selected month: the previous month's closing
 *  balance and every week of the selected month (the original Ageing Trend layout), plus the balance
 *  at the selected month's end (the figure the slide's debtor tiles use when the month is already
 *  closed). Same permission as the Receivables module. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const allowedPages = session.user.allowedPages ?? [];
  if (session.user.role !== "ADMIN" && !allowedPages.includes("receivables")) {
    return NextResponse.json({ error: "Receivables access required." }, { status: 403 });
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const monthIndex = Number(req.nextUrl.searchParams.get("monthIndex"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return NextResponse.json({ error: "year and monthIndex are required." }, { status: 400 });
  }

  try {
    const nextYear = monthIndex === 11 ? year + 1 : year;
    const nextIndex = monthIndex === 11 ? 0 : monthIndex + 1;
    const now = new Date();
    const isCurrentMonth = year === now.getUTCFullYear() && monthIndex === now.getUTCMonth();

    const [selected, following] = await Promise.all([
      getAgeingSnapshotForMonth(year, monthIndex, { blankWeeksNotElapsed: true }),
      // A closed month's end is the next month's "last month" point (nearest snapshot at or before its last day).
      isCurrentMonth ? Promise.resolve(null) : getAgeingSnapshotForMonth(nextYear, nextIndex),
    ]);
    return NextResponse.json(
      { selected, monthEnd: following ? following.lastMonth : null },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Failed to load the Finance Presentation ageing", error);
    return NextResponse.json({ error: "Failed to load the receivables ageing." }, { status: 500 });
  }
}

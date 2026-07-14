import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy drill-down: JPAdherenceDetail is only fetched for one rep-day at a
// time (?date=YYYY-MM-DD&employeeCode=...), never the whole table, since it
// can be structurally large (multi-month x many-outlet explosion).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const dateParam = req.nextUrl.searchParams.get("date");
  const employeeCode = req.nextUrl.searchParams.get("employeeCode");
  if (!dateParam || !employeeCode) {
    return NextResponse.json({ error: "Both date and employeeCode query params are required." }, { status: 400 });
  }
  const date = new Date(dateParam);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }

  try {
    const detail = await prisma.jPAdherenceDetail.findMany({
      where: { date, employeeCode },
      orderBy: [{ customerName: "asc" }],
    });
    return NextResponse.json({ detail });
  } catch (err) {
    console.error("Failed to load JP Adherence detail", err);
    return NextResponse.json({ error: "Failed to load JP Adherence detail." }, { status: 500 });
  }
}

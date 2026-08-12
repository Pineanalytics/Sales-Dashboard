import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const salesman = req.nextUrl.searchParams.get("rep")?.trim();
  const month = req.nextUrl.searchParams.get("month");
  if (!salesman) return NextResponse.json({ error: '"rep" is required.' }, { status: 400 });
  if (month && !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const now = new Date();
  const start = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  try {
    const visits = await prisma.eablCall.findMany({
      where: { salesman, callDate: { gte: start, lt: end } },
      orderBy: [{ callDate: "asc" }, { timeIn: "asc" }],
      select: { callDate: true, customerName: true, customerType: true, segment: true, timeIn: true, timeOut: true, durationMinutes: true, netSales: true, isProductive: true, callsInDay: true, productiveCallsInDay: true, dayStrikeRatePct: true },
    });
    return NextResponse.json({ salesman, visits });
  } catch (error) {
    console.error("Failed to load EABL rep detail", error);
    return NextResponse.json({ error: "Failed to load EABL rep detail." }, { status: 500 });
  }
}

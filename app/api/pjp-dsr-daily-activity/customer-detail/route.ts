import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-rep, per-customer invoice/return browsing for the Leverage timestamp
// page's customer leaderboard drawer — same shape as
// /api/eabl-call-performance/rep-detail, but every row here is a completed
// SalesReturnLine transaction (no isProductive/timeIn/timeOut fields exist
// in this source; see customers/route.ts's own header comment).

function monthWindow(month: string | null) {
  const now = new Date();
  const key = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = new Date(`${key}-01T00:00:00+03:00`);
  const [year, monthNumber] = key.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+03:00`);
  return { start, end };
}

function dayWindow(date: string) {
  const start = new Date(`${date}T00:00:00+03:00`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // "rep" is a salesRepName (see customers/route.ts's header comment for why
  // this section keys on name rather than salesRepCode).
  const salesRepName = request.nextUrl.searchParams.get("rep")?.trim();
  if (!salesRepName) return NextResponse.json({ error: '"rep" is required.' }, { status: 400 });
  const month = request.nextUrl.searchParams.get("month");
  if (month && !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return NextResponse.json({ error: '"date" must be YYYY-MM-DD.' }, { status: 400 });

  const monthRange = monthWindow(month);
  const range = selectedDate ? dayWindow(selectedDate) : monthRange;

  try {
    const visits = await prisma.salesReturnLine.findMany({
      where: { salesRepName, deliveryDate: { gte: range.start, lt: range.end } },
      orderBy: [{ deliveryDate: "asc" }, { invoiceNo: "asc" }],
      select: {
        deliveryDate: true, customerCode: true, route: true, routeName: true,
        invoiceNo: true, documentType: true, documentTypeDesc: true,
        saleQtyPieces: true, freeQtyPieces: true, netSale: true,
      },
    });
    return NextResponse.json({
      salesRepName,
      visits: visits.map((v) => ({
        date: v.deliveryDate.toISOString().slice(0, 10),
        customerCode: v.customerCode,
        route: v.route, routeName: v.routeName,
        invoiceNo: v.invoiceNo,
        documentType: v.documentType, documentTypeDesc: v.documentTypeDesc,
        saleQtyPieces: v.saleQtyPieces, freeQtyPieces: v.freeQtyPieces,
        netSale: v.netSale,
      })),
    });
  } catch (error) {
    console.error("Failed to load Unilever Leverage customer detail", error);
    return NextResponse.json({ error: "Failed to load Unilever Leverage customer detail." }, { status: 500 });
  }
}

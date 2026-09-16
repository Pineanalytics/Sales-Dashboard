import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-rep detail for the Leverage timestamp page's customer leaderboard
// drawer — same overall/dailyTrend/weeklyTrend/visits shape as Pine's own
// rep detail (lib/timestampSummary.ts's getTimestampRepDetail /
// app/api/timestamps/rep-detail), including the same "Week N" (day-of-month
// ÷ 7) bucketing convention, so the Leverage drawer reads like Pine's rep
// journey panel. Every row here is a completed SalesReturnLine transaction —
// no isProductive/timeIn/timeOut/outletId fields exist in this source, so
// "overall"/trend rows use Customers/Net sales/Pieces instead of
// Strike rate/Outlets Covered (see customers/route.ts's header comment for
// why a strike rate can't be computed from this source at all).

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

const number = (value: bigint | number | null | undefined) => (value == null ? 0 : Number(value));

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
  const where = Prisma.sql`"salesRepName" = ${salesRepName} AND "deliveryDate" >= ${range.start} AND "deliveryDate" < ${range.end}`;

  type OverallRow = { customers: bigint; transactions: bigint; activeDays: bigint; netSales: number; saleQtyPieces: number; freeQtyPieces: number };
  type TrendRow = { label: string; customers: bigint; transactions: bigint; netSales: number; saleQtyPieces: number };

  try {
    const [overallRows, dailyTrend, weeklyTrend, visits] = await Promise.all([
      prisma.$queryRaw<OverallRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT "customerCode") AS customers, COUNT(*)::int AS transactions,
          COUNT(DISTINCT "deliveryDate"::date) AS "activeDays",
          COALESCE(SUM("netSale"), 0)::double precision AS "netSales",
          COALESCE(SUM("saleQtyPieces"), 0)::double precision AS "saleQtyPieces",
          COALESCE(SUM("freeQtyPieces"), 0)::double precision AS "freeQtyPieces"
        FROM "SalesReturnLine" WHERE ${where}`),
      prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT to_char("deliveryDate", 'YYYY-MM-DD') AS label, COUNT(DISTINCT "customerCode") AS customers,
          COUNT(*)::int AS transactions, COALESCE(SUM("netSale"), 0)::double precision AS "netSales",
          COALESCE(SUM("saleQtyPieces"), 0)::double precision AS "saleQtyPieces"
        FROM "SalesReturnLine" WHERE ${where}
        GROUP BY "deliveryDate" ORDER BY "deliveryDate"`),
      // Same "Week N" (calendar day-of-month ÷ 7) bucketing as Pine's own
      // weeklyTrend (lib/timestampSummary.ts's getTimestampRepDetail).
      prisma.$queryRaw<TrendRow[]>(Prisma.sql`
        SELECT CONCAT('Week ', CEIL(EXTRACT(DAY FROM "deliveryDate")::numeric / 7)::integer) AS label,
          COUNT(DISTINCT "customerCode") AS customers, COUNT(*)::int AS transactions,
          COALESCE(SUM("netSale"), 0)::double precision AS "netSales",
          COALESCE(SUM("saleQtyPieces"), 0)::double precision AS "saleQtyPieces"
        FROM "SalesReturnLine" WHERE ${where}
        GROUP BY CEIL(EXTRACT(DAY FROM "deliveryDate")::numeric / 7)::integer
        ORDER BY CEIL(EXTRACT(DAY FROM "deliveryDate")::numeric / 7)::integer`),
      prisma.salesReturnLine.findMany({
        where: { salesRepName, deliveryDate: { gte: range.start, lt: range.end } },
        orderBy: [{ deliveryDate: "asc" }, { invoiceNo: "asc" }],
        select: {
          deliveryDate: true, customerCode: true, route: true, routeName: true,
          invoiceNo: true, documentType: true, documentTypeDesc: true,
          saleQtyPieces: true, freeQtyPieces: true, netSale: true,
        },
      }),
    ]);

    const overall = overallRows[0];
    const transactions = number(overall?.transactions);
    return NextResponse.json({
      salesRepName,
      overall: {
        customers: number(overall?.customers), transactions, activeDays: number(overall?.activeDays),
        netSales: overall?.netSales ?? 0, saleQtyPieces: overall?.saleQtyPieces ?? 0, freeQtyPieces: overall?.freeQtyPieces ?? 0,
        avgNetSalePerTransaction: transactions > 0 ? (overall?.netSales ?? 0) / transactions : null,
      },
      dailyTrend: dailyTrend.map((r) => ({ label: r.label, customers: number(r.customers), transactions: number(r.transactions), netSales: r.netSales, saleQtyPieces: r.saleQtyPieces })),
      weeklyTrend: weeklyTrend.map((r) => ({ label: r.label, customers: number(r.customers), transactions: number(r.transactions), netSales: r.netSales, saleQtyPieces: r.saleQtyPieces })),
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

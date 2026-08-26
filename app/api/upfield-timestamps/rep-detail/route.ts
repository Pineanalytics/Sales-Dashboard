import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAIROBI_OFFSET = Prisma.sql`INTERVAL '3 hours'`;
const REP_EXPRESSION = Prisma.sql`REGEXP_REPLACE(BTRIM(fsr), '\\s+', ' ', 'g')`;

function window(month: string, selectedDate: string | null) {
  const key = selectedDate ?? `${month}-01`;
  const start = new Date(`${key}T00:00:00+03:00`);
  if (selectedDate) {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return { start, end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+03:00`) };
}

const number = (value: bigint | number | null | undefined) => value == null ? 0 : Number(value);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const rep = request.nextUrl.searchParams.get("rep")?.trim();
  const month = request.nextUrl.searchParams.get("month");
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (!rep) return NextResponse.json({ error: '"rep" is required.' }, { status: 400 });
  if (rep.length > 120) return NextResponse.json({ error: '"rep" is too long.' }, { status: 400 });
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return NextResponse.json({ error: '"date" must be YYYY-MM-DD.' }, { status: 400 });
  if (selectedDate && !selectedDate.startsWith(`${month}-`)) return NextResponse.json({ error: '"date" must fall within the selected month.' }, { status: 400 });

  const range = window(month, selectedDate);
  type DocumentRow = {
    date: Date; customerCode: string; customerName: string; invoiceNo: string; type: string;
    firstTransaction: Date; lastTransaction: Date; lines: bigint; products: bigint; netSales: number; units: number;
  };
  try {
    const rows = await prisma.$queryRaw<DocumentRow[]>(Prisma.sql`
      SELECT DATE("txnDate" + ${NAIROBI_OFFSET}) AS date,
        COALESCE(NULLIF(BTRIM("custCode"), ''), 'Uncoded') AS "customerCode",
        COALESCE(NULLIF(BTRIM("custName"), ''), 'Unnamed outlet') AS "customerName",
        "invoiceNo", type,
        MIN("txnDate" + ${NAIROBI_OFFSET}) AS "firstTransaction",
        MAX("txnDate" + ${NAIROBI_OFFSET}) AS "lastTransaction",
        COUNT(*) AS lines, COUNT(DISTINCT "itemCode") AS products,
        COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales",
        COALESCE(SUM(qty), 0)::double precision AS units
      FROM "UpfieldTransaction"
      WHERE "txnDate" >= ${range.start} AND "txnDate" < ${range.end}
        AND ${REP_EXPRESSION} = ${rep}
        AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST'
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1, 6, 2, 4`);

    return NextResponse.json({
      rep, month, date: selectedDate,
      documents: rows.map((row) => ({
        ...row,
        date: row.date.toISOString().slice(0, 10),
        firstTransaction: row.firstTransaction.toISOString(),
        lastTransaction: row.lastTransaction.toISOString(),
        lines: number(row.lines), products: number(row.products),
      })),
      definition: "Each row is one DataEdge sales or return document at an outlet; timestamps are source transaction times, not GPS check-ins.",
    });
  } catch (error) {
    console.error("Failed to load Upfield rep transaction detail", error);
    return NextResponse.json({ error: "Failed to load Upfield rep transaction detail." }, { status: 500 });
  }
}

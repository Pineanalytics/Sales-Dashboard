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
  type VisitRow = {
    date: Date; pop: string; distributor: string | null; startTime: Date; endTime: Date | null;
    timeInOutlet: string | null; transitTime: string | null; lppc: number | null; sale: number;
  };
  try {
    const rows = await prisma.$queryRaw<VisitRow[]>(Prisma.sql`
      SELECT DATE("startTime" + ${NAIROBI_OFFSET}) AS date, pop, distributor,
        "startTime" + ${NAIROBI_OFFSET} AS "startTime",
        CASE WHEN "endTime" IS NULL THEN NULL ELSE "endTime" + ${NAIROBI_OFFSET} END AS "endTime",
        "timeInOutlet", "transitTime", lppc, COALESCE(sale, 0)::double precision AS sale
      FROM "UpfieldVisit"
      WHERE "startTime" >= ${range.start} AND "startTime" < ${range.end}
        AND ${REP_EXPRESSION} = ${rep}
      ORDER BY 1, "startTime"`);

    return NextResponse.json({
      rep, month, date: selectedDate,
      visits: rows.map((row) => ({
        ...row,
        date: row.date.toISOString().slice(0, 10),
        startTime: row.startTime.toISOString(),
        endTime: row.endTime ? row.endTime.toISOString() : null,
        sale: row.sale,
      })),
      definition: "Each row is one outlet visit from the Timestamp Report — check-in (Start Time) to check-out (End Time), not a sales document.",
    });
  } catch (error) {
    console.error("Failed to load Upfield rep visit detail", error);
    return NextResponse.json({ error: "Failed to load Upfield rep visit detail." }, { status: 500 });
  }
}

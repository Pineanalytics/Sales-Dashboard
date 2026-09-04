import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// startTime/endTime arrive as real, correctly-offset UTC instants (the
// downloader converts the source's naive Nairobi text with a real -3h
// correction — see F:\UpfieldSalesRawData\src\dates.js parseNairobiDateTime).
// Same "+3h then read as UTC" trick as upfield-timestamps/summary is applied
// here purely for display: it produces a Nairobi-wall-clock-shaped value the
// front end can read with getUTCHours() without a second timezone
// conversion — the stored instant itself needs no correction.
const NAIROBI_OFFSET = Prisma.sql`INTERVAL '3 hours'`;
const REP_EXPRESSION = Prisma.sql`REGEXP_REPLACE(BTRIM(fsr), '\\s+', ' ', 'g')`;

function monthKey(raw: string | null): string {
  const now = new Date();
  return raw && /^\d{4}-\d{2}$/.test(raw) ? raw : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function localWindow(month: string, selectedDate: string | null) {
  const key = selectedDate ?? `${month}-01`;
  const start = new Date(`${key}T00:00:00+03:00`);
  const end = new Date(start);
  if (selectedDate) end.setUTCDate(end.getUTCDate() + 1);
  else {
    const [year, monthNumber] = month.split("-").map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    return { start, end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+03:00`) };
  }
  return { start, end };
}

const number = (value: bigint | number | null | undefined) => value == null ? 0 : Number(value);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const day = (value: Date) => value.toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const rawMonth = request.nextUrl.searchParams.get("month");
  if (rawMonth && !/^\d{4}-\d{2}$/.test(rawMonth)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const month = monthKey(rawMonth);
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return NextResponse.json({ error: '"date" must be YYYY-MM-DD.' }, { status: 400 });
  if (selectedDate && !selectedDate.startsWith(`${month}-`)) return NextResponse.json({ error: '"date" must fall within the selected month.' }, { status: 400 });
  const rep = request.nextUrl.searchParams.get("rep")?.trim() || null;
  if (rep && rep.length > 120) return NextResponse.json({ error: '"rep" is too long.' }, { status: 400 });

  const monthRange = localWindow(month, null);
  const activeRange = localWindow(month, selectedDate);
  const baseConditions = [
    Prisma.sql`"startTime" >= ${activeRange.start}`,
    Prisma.sql`"startTime" < ${activeRange.end}`,
    Prisma.sql`NULLIF(BTRIM(fsr), '') IS NOT NULL`,
  ];
  if (rep) baseConditions.push(Prisma.sql`${REP_EXPRESSION} = ${rep}`);
  const where = Prisma.join(baseConditions, " AND ");
  const monthWhere = Prisma.sql`"startTime" >= ${monthRange.start} AND "startTime" < ${monthRange.end} AND NULLIF(BTRIM(fsr), '') IS NOT NULL`;

  type MetricsRow = { visits: bigint; outlets: bigint; reps: bigint; sale: number; visitsWithSale: bigint; open: bigint; lastDataAt: Date | null };
  type DailyRow = { date: Date; visits: bigint; outlets: bigint; reps: bigint; sale: number };
  type HourlyRow = { hour: number; visits: bigint; outlets: bigint };
  type RepDayRow = { date: Date; rep: string; firstVisit: Date; lastActivity: Date; visits: bigint; outlets: bigint; sale: number; visitsWithSale: bigint };
  type CoverageRow = { rep: string; activeDays: bigint; outlets: bigint; outletDays: bigint; averageOutletsPerDay: number; visits: bigint; sale: number };
  type OutletRow = { pop: string; activeDays: bigint; reps: bigint; visits: bigint; sale: number; lastVisit: Date };

  try {
    const [metrics, daily, hourly, repDays, coverage, outlets, filterReps, filterDates, watermark, latestRun] = await Promise.all([
      prisma.$queryRaw<MetricsRow[]>(Prisma.sql`
        SELECT COUNT(*) AS visits,
          COUNT(DISTINCT pop) AS outlets,
          COUNT(DISTINCT ${REP_EXPRESSION}) AS reps,
          COALESCE(SUM(sale), 0)::double precision AS sale,
          COUNT(*) FILTER (WHERE COALESCE(sale, 0) > 0) AS "visitsWithSale",
          COUNT(*) FILTER (WHERE "endTime" IS NULL) AS open,
          MAX("startTime") AS "lastDataAt"
        FROM "UpfieldVisit" WHERE ${where}`),
      prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT DATE("startTime" + ${NAIROBI_OFFSET}) AS date,
          COUNT(*) AS visits, COUNT(DISTINCT pop) AS outlets, COUNT(DISTINCT ${REP_EXPRESSION}) AS reps,
          COALESCE(SUM(sale), 0)::double precision AS sale
        FROM "UpfieldVisit" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<HourlyRow[]>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM "startTime" + ${NAIROBI_OFFSET})::int AS hour,
          COUNT(*) AS visits, COUNT(DISTINCT pop) AS outlets
        FROM "UpfieldVisit" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<RepDayRow[]>(Prisma.sql`
        SELECT DATE("startTime" + ${NAIROBI_OFFSET}) AS date, ${REP_EXPRESSION} AS rep,
          MIN("startTime" + ${NAIROBI_OFFSET}) AS "firstVisit",
          MAX(COALESCE("endTime", "startTime") + ${NAIROBI_OFFSET}) AS "lastActivity",
          COUNT(*) AS visits, COUNT(DISTINCT pop) AS outlets,
          COALESCE(SUM(sale), 0)::double precision AS sale,
          COUNT(*) FILTER (WHERE COALESCE(sale, 0) > 0) AS "visitsWithSale"
        FROM "UpfieldVisit" WHERE ${where}
        GROUP BY 1, 2 ORDER BY 1 DESC, "firstVisit" DESC`),
      prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
        SELECT ${REP_EXPRESSION} AS rep, COUNT(DISTINCT DATE("startTime" + ${NAIROBI_OFFSET})) AS "activeDays",
          COUNT(DISTINCT pop) AS outlets,
          COUNT(DISTINCT (DATE("startTime" + ${NAIROBI_OFFSET}), pop)) AS "outletDays",
          (COUNT(DISTINCT (DATE("startTime" + ${NAIROBI_OFFSET}), pop)) /
            NULLIF(COUNT(DISTINCT DATE("startTime" + ${NAIROBI_OFFSET})), 0)::double precision) AS "averageOutletsPerDay",
          COUNT(*) AS visits, COALESCE(SUM(sale), 0)::double precision AS sale
        FROM "UpfieldVisit" WHERE ${where} GROUP BY 1 ORDER BY "outletDays" DESC, sale DESC`),
      prisma.$queryRaw<OutletRow[]>(Prisma.sql`
        SELECT pop, COUNT(DISTINCT DATE("startTime" + ${NAIROBI_OFFSET})) AS "activeDays",
          COUNT(DISTINCT ${REP_EXPRESSION}) AS reps, COUNT(*) AS visits,
          COALESCE(SUM(sale), 0)::double precision AS sale, MAX("startTime" + ${NAIROBI_OFFSET}) AS "lastVisit"
        FROM "UpfieldVisit" WHERE ${where}
        GROUP BY 1 ORDER BY "activeDays" DESC, sale DESC LIMIT 25`),
      prisma.$queryRaw<Array<{ rep: string }>>(Prisma.sql`SELECT DISTINCT ${REP_EXPRESSION} AS rep FROM "UpfieldVisit" WHERE ${monthWhere} ORDER BY 1`),
      prisma.$queryRaw<Array<{ date: Date }>>(Prisma.sql`SELECT DISTINCT DATE("startTime" + ${NAIROBI_OFFSET}) AS date FROM "UpfieldVisit" WHERE ${monthWhere} ORDER BY 1 DESC`),
      prisma.syncWatermark.findUnique({ where: { bridge: "upfield-visits" }, select: { updatedAt: true, lastIncrementalAt: true } }),
      prisma.upfieldSyncRun.findFirst({ where: { source: "upfield-visits", status: "COMPLETE" }, orderBy: { completedAt: "desc" }, select: { completedAt: true, windowEnd: true, recordCount: true } }),
    ]);

    const metric = metrics[0];
    return NextResponse.json({
      scope: "Upfield · Outlet Visits", month,
      metrics: {
        visits: number(metric?.visits), outlets: number(metric?.outlets), reps: number(metric?.reps),
        sale: metric?.sale ?? 0, visitsWithSale: number(metric?.visitsWithSale), open: number(metric?.open),
        lastDataAt: iso(metric?.lastDataAt),
      },
      daily: daily.map((row) => ({ date: day(row.date), visits: number(row.visits), outlets: number(row.outlets), reps: number(row.reps), sale: row.sale })),
      hourly: hourly.map((row) => ({ hour: row.hour, visits: number(row.visits), outlets: number(row.outlets) })),
      repDays: repDays.map((row) => ({ ...row, date: day(row.date), firstVisit: iso(row.firstVisit), lastActivity: iso(row.lastActivity), visits: number(row.visits), outlets: number(row.outlets), visitsWithSale: number(row.visitsWithSale) })),
      coverage: coverage.map((row) => ({ ...row, activeDays: number(row.activeDays), outlets: number(row.outlets), outletDays: number(row.outletDays), visits: number(row.visits) })),
      outlets: outlets.map((row) => ({ ...row, activeDays: number(row.activeDays), reps: number(row.reps), visits: number(row.visits), lastVisit: iso(row.lastVisit) })),
      filters: { reps: filterReps.map((row) => row.rep), dates: filterDates.map((row) => day(row.date)) },
      freshness: { syncedAt: iso(watermark?.updatedAt), through: iso(watermark?.lastIncrementalAt), latestRunCompletedAt: iso(latestRun?.completedAt), latestRunRows: latestRun?.recordCount ?? null },
      definitions: {
        coverage: "Unique outlets (POP) with at least one recorded visit in the selected period.",
        time: "Check-in (Start Time) and check-out (End Time) as captured by the Timestamp Report, converted from the stored UTC instant to Nairobi wall-clock time. A blank check-out means the rep had not checked out at the time of the 4x-daily pull; that visit's row is not counted as 'closed'. Upfield start status uses an 8:00 AM benchmark.",
      },
    });
  } catch (error) {
    console.error("Failed to load Upfield Outlet Visits", error);
    return NextResponse.json({ error: "Failed to load Upfield Outlet Visits." }, { status: 500 });
  }
}

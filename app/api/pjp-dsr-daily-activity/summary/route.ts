import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PjpDsrDailyActivity.date/firstEntryTime/lastEntryTime are already Nairobi
// wall-clock instants (CASHMEMO.DATE_ENTRY, entered by field staff with no
// timezone conversion anywhere in the pipeline — see the source query's own
// comment in scripts/db-bridge/sales-returns/pjpDsrDailyActivityQuery.ts).
// No NAIROBI_OFFSET shift is needed here, unlike upfield-timestamps/summary —
// lib/timeManagement.ts's nairobiMinutesAfterMidnight already reads this
// exact convention directly.

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
const branchLabel = (distributor: string) => SALES_RETURNS_BRANCH_LABELS[distributor] ?? distributor;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const rawMonth = request.nextUrl.searchParams.get("month");
  if (rawMonth && !/^\d{4}-\d{2}$/.test(rawMonth)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const month = monthKey(rawMonth);
  const selectedDate = request.nextUrl.searchParams.get("date");
  if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return NextResponse.json({ error: '"date" must be YYYY-MM-DD.' }, { status: 400 });
  if (selectedDate && !selectedDate.startsWith(`${month}-`)) return NextResponse.json({ error: '"date" must fall within the selected month.' }, { status: 400 });
  const distributor = request.nextUrl.searchParams.get("distributor");
  if (distributor && !/^\d+$/.test(distributor)) return NextResponse.json({ error: '"distributor" must be a numeric branch code.' }, { status: 400 });
  const rep = request.nextUrl.searchParams.get("rep")?.trim() || null;
  if (rep && rep.length > 120) return NextResponse.json({ error: '"rep" is too long.' }, { status: 400 });

  const monthRange = localWindow(month, null);
  const activeRange = localWindow(month, selectedDate);
  const baseConditions = [
    Prisma.sql`date >= ${activeRange.start}`,
    Prisma.sql`date < ${activeRange.end}`,
  ];
  if (distributor) baseConditions.push(Prisma.sql`distributor = ${distributor}`);
  if (rep) baseConditions.push(Prisma.sql`"dsrName" = ${rep}`);
  const where = Prisma.join(baseConditions, " AND ");
  const monthConditions = [Prisma.sql`date >= ${monthRange.start}`, Prisma.sql`date < ${monthRange.end}`];
  if (distributor) monthConditions.push(Prisma.sql`distributor = ${distributor}`);
  const monthWhere = Prisma.join(monthConditions, " AND ");

  type MetricsRow = {
    pjps: bigint; dsrs: bigint; transactions: number; outletVisits: number;
    handheldTransactions: number; lastDataAt: Date | null; averageSpanMinutes: number | null; averageGapMinutes: number | null;
  };
  type DailyRow = { date: Date; transactions: number; outletVisits: number; dsrs: bigint; pjps: bigint };
  type RepDayRow = {
    date: Date; distributor: string; dsr: string; dsrName: string; routes: string;
    firstEntryTime: Date | null; lastEntryTime: Date | null; transactions: number; outletVisits: number;
    handheldTransactions: number; activeSpanMinutes: number | null;
  };
  type CoverageRow = {
    distributor: string; dsr: string; dsrName: string; activeDays: bigint; transactions: number;
    outletVisits: number; averageOutletsPerDay: number; handheldTransactions: number;
  };
  type RouteRow = { distributor: string; pjp: string; route: string; activeDays: bigint; dsrs: bigint; transactions: number; outletVisits: number };

  try {
    const [metrics, daily, repDays, coverage, routes, filterReps, filterDates, watermarks] = await Promise.all([
      prisma.$queryRaw<MetricsRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT (distributor, pjp)) AS pjps,
          COUNT(DISTINCT (distributor, dsr)) AS dsrs,
          COALESCE(SUM("transactionCount"), 0)::int AS transactions,
          COALESCE(SUM("outletsVisited"), 0)::int AS "outletVisits",
          COALESCE(SUM("handheldTransactionCount"), 0)::int AS "handheldTransactions",
          MAX(date) AS "lastDataAt",
          AVG("activeSpanMinutes")::double precision AS "averageSpanMinutes",
          AVG("avgGapMinutes")::double precision AS "averageGapMinutes"
        FROM "PjpDsrDailyActivity" WHERE ${where}`),
      prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT date, COALESCE(SUM("transactionCount"), 0)::int AS transactions,
          COALESCE(SUM("outletsVisited"), 0)::int AS "outletVisits",
          COUNT(DISTINCT (distributor, dsr)) AS dsrs, COUNT(DISTINCT (distributor, pjp)) AS pjps
        FROM "PjpDsrDailyActivity" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<RepDayRow[]>(Prisma.sql`
        SELECT date, distributor, dsr, "dsrName",
          STRING_AGG(DISTINCT route, ', ' ORDER BY route) AS routes,
          MIN("firstEntryTime") AS "firstEntryTime",
          MAX(COALESCE("lastEntryTime", "firstEntryTime")) AS "lastEntryTime",
          SUM("transactionCount")::int AS transactions, SUM("outletsVisited")::int AS "outletVisits",
          SUM("handheldTransactionCount")::int AS "handheldTransactions",
          MAX("activeSpanMinutes") AS "activeSpanMinutes"
        FROM "PjpDsrDailyActivity" WHERE ${where}
        GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, "firstEntryTime" DESC`),
      prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
        SELECT distributor, dsr, "dsrName", COUNT(DISTINCT date) AS "activeDays",
          SUM("transactionCount")::int AS transactions, SUM("outletsVisited")::int AS "outletVisits",
          (SUM("outletsVisited") / NULLIF(COUNT(DISTINCT date), 0)::double precision) AS "averageOutletsPerDay",
          SUM("handheldTransactionCount")::int AS "handheldTransactions"
        FROM "PjpDsrDailyActivity" WHERE ${where}
        GROUP BY 1, 2, 3 ORDER BY "activeDays" DESC, transactions DESC`),
      prisma.$queryRaw<RouteRow[]>(Prisma.sql`
        SELECT distributor, pjp, MAX(route) AS route, COUNT(DISTINCT date) AS "activeDays",
          COUNT(DISTINCT dsr) AS dsrs, SUM("transactionCount")::int AS transactions, SUM("outletsVisited")::int AS "outletVisits"
        FROM "PjpDsrDailyActivity" WHERE ${where}
        GROUP BY 1, 2 ORDER BY "activeDays" DESC, transactions DESC LIMIT 25`),
      prisma.$queryRaw<Array<{ rep: string }>>(Prisma.sql`SELECT DISTINCT "dsrName" AS rep FROM "PjpDsrDailyActivity" WHERE ${monthWhere} ORDER BY 1`),
      prisma.$queryRaw<Array<{ date: Date }>>(Prisma.sql`SELECT DISTINCT date FROM "PjpDsrDailyActivity" WHERE ${monthWhere} ORDER BY 1 DESC`),
      prisma.syncWatermark.findMany({ where: { bridge: { startsWith: "sales-returns:" } } }),
    ]);

    const metric = metrics[0];
    const transactions = number(metric?.transactions);
    const handheldTransactions = number(metric?.handheldTransactions);
    return NextResponse.json({
      scope: "Unilever · Leverage", month,
      metrics: {
        pjps: number(metric?.pjps), dsrs: number(metric?.dsrs), transactions, outletVisits: number(metric?.outletVisits),
        handheldTransactions, handheldShare: transactions > 0 ? handheldTransactions / transactions : null,
        averageSpanMinutes: metric?.averageSpanMinutes ?? null, averageGapMinutes: metric?.averageGapMinutes ?? null,
        lastDataAt: iso(metric?.lastDataAt),
      },
      daily: daily.map((row) => ({ date: day(row.date), transactions: row.transactions, outletVisits: row.outletVisits, dsrs: number(row.dsrs), pjps: number(row.pjps) })),
      repDays: repDays.map((row) => ({
        ...row, date: day(row.date), distributorLabel: branchLabel(row.distributor),
        firstEntryTime: iso(row.firstEntryTime), lastEntryTime: iso(row.lastEntryTime),
      })),
      coverage: coverage.map((row) => ({ ...row, distributorLabel: branchLabel(row.distributor), activeDays: number(row.activeDays) })),
      routes: routes.map((row) => ({ ...row, distributorLabel: branchLabel(row.distributor), activeDays: number(row.activeDays), dsrs: number(row.dsrs) })),
      filters: {
        reps: filterReps.map((row) => row.rep),
        dates: filterDates.map((row) => day(row.date)),
        distributors: Object.entries(SALES_RETURNS_BRANCH_LABELS).map(([code, label]) => ({ code, label })),
      },
      freshness: {
        branches: watermarks.map((watermark) => ({
          distributor: watermark.bridge.slice("sales-returns:".length),
          distributorLabel: branchLabel(watermark.bridge.slice("sales-returns:".length)),
          syncedAt: iso(watermark.updatedAt),
        })),
      },
      definitions: {
        coverage: "Outlet visits and transactions as captured by the handheld device (or manual/office entry when handheldTransactions is 0 — see the data-quality note).",
        time: "First and last CASHMEMO entry time (DATE_ENTRY) per rep per day, Africa/Nairobi wall-clock as captured by the field DMS. A PJP/DSR whose entries are 0% handheld is likely office/manual entry, not real field timing — treat its times with caution.",
      },
    });
  } catch (error) {
    console.error("Failed to load Unilever Leverage PJP/DSR activity", error);
    return NextResponse.json({ error: "Failed to load Unilever Leverage PJP/DSR activity." }, { status: 500 });
  }
}

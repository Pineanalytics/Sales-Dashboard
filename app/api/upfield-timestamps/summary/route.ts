import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    Prisma.sql`"txnDate" >= ${activeRange.start}`,
    Prisma.sql`"txnDate" < ${activeRange.end}`,
    Prisma.sql`NULLIF(BTRIM(fsr), '') IS NOT NULL`,
    Prisma.sql`UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST'`,
  ];
  if (rep) baseConditions.push(Prisma.sql`${REP_EXPRESSION} = ${rep}`);
  const where = Prisma.join(baseConditions, " AND ");
  const monthWhere = Prisma.sql`"txnDate" >= ${monthRange.start} AND "txnDate" < ${monthRange.end} AND NULLIF(BTRIM(fsr), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST'`;

  type MetricsRow = { lines: bigint; invoices: bigint; outlets: bigint; reps: bigint; netSales: number; units: number; returnsValue: number; lastDataAt: Date | null; averageInterval: number | null };
  type DailyRow = { date: Date; invoices: bigint; outlets: bigint; reps: bigint; netSales: number; units: number };
  type HourlyRow = { hour: number; invoices: bigint; outlets: bigint; netSales: number };
  type RepDayRow = { date: Date; rep: string; firstTransaction: Date; lastTransaction: Date; hoursInTrade: number; invoices: bigint; outlets: bigint; lines: bigint; netSales: number; units: number; averageInterval: number | null };
  type CoverageRow = { rep: string; activeDays: bigint; outlets: bigint; outletDays: bigint; averageOutletsPerDay: number; invoices: bigint; netSales: number; units: number };
  type CustomerRow = { customerCode: string; customerName: string; activeDays: bigint; reps: bigint; invoices: bigint; netSales: number; units: number; lastTransaction: Date };

  try {
    const [metrics, daily, hourly, repDays, coverage, customers, filterReps, filterDates, watermark, latestRun] = await Promise.all([
      prisma.$queryRaw<MetricsRow[]>(Prisma.sql`
        WITH documents AS (
          SELECT ${REP_EXPRESSION} AS rep, DATE("txnDate" + ${NAIROBI_OFFSET}) AS date, "invoiceNo", MIN("txnDate" + ${NAIROBI_OFFSET}) AS txn
          FROM "UpfieldTransaction" WHERE ${where} AND type = 'sale'
          GROUP BY 1, 2, 3
        ), gaps AS (
          SELECT EXTRACT(EPOCH FROM (txn - LAG(txn) OVER (PARTITION BY rep, date ORDER BY txn))) / 60.0 AS minutes FROM documents
        )
        SELECT COUNT(*) AS lines,
          COUNT(DISTINCT "invoiceNo") FILTER (WHERE type = 'sale') AS invoices,
          COUNT(DISTINCT "custCode") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS outlets,
          COUNT(DISTINCT ${REP_EXPRESSION}) AS reps,
          COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales",
          COALESCE(SUM(qty), 0)::double precision AS units,
          ABS(COALESCE(SUM("saleIncl") FILTER (WHERE type = 'return'), 0))::double precision AS "returnsValue",
          MAX("txnDate") AS "lastDataAt",
          (SELECT AVG(minutes)::double precision FROM gaps WHERE minutes > 0 AND minutes < 480) AS "averageInterval"
        FROM "UpfieldTransaction" WHERE ${where}`),
      prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT DATE("txnDate" + ${NAIROBI_OFFSET}) AS date,
          COUNT(DISTINCT "invoiceNo") FILTER (WHERE type = 'sale') AS invoices,
          COUNT(DISTINCT "custCode") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS outlets,
          COUNT(DISTINCT ${REP_EXPRESSION}) AS reps,
          COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales", COALESCE(SUM(qty), 0)::double precision AS units
        FROM "UpfieldTransaction" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<HourlyRow[]>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM "txnDate" + ${NAIROBI_OFFSET})::int AS hour,
          COUNT(DISTINCT "invoiceNo") FILTER (WHERE type = 'sale') AS invoices,
          COUNT(DISTINCT "custCode") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS outlets,
          COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales"
        FROM "UpfieldTransaction" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<RepDayRow[]>(Prisma.sql`
        WITH base AS (
          SELECT ${REP_EXPRESSION} AS rep, DATE("txnDate" + ${NAIROBI_OFFSET}) AS date, "txnDate" + ${NAIROBI_OFFSET} AS txn,
            "invoiceNo", "custCode", type, "saleIncl", qty
          FROM "UpfieldTransaction" WHERE ${where}
        ), documents AS (
          SELECT rep, date, "invoiceNo", MIN(txn) AS txn FROM base WHERE type = 'sale' GROUP BY 1, 2, 3
        ), gaps AS (
          SELECT rep, date, EXTRACT(EPOCH FROM (txn - LAG(txn) OVER (PARTITION BY rep, date ORDER BY txn))) / 60.0 AS minutes FROM documents
        ), intervals AS (
          SELECT rep, date, (AVG(minutes) FILTER (WHERE minutes > 0 AND minutes < 480))::double precision AS "averageInterval" FROM gaps GROUP BY 1, 2
        )
        SELECT b.date, b.rep, MIN(b.txn) AS "firstTransaction", MAX(b.txn) AS "lastTransaction",
          (EXTRACT(EPOCH FROM (MAX(b.txn) - MIN(b.txn))) / 3600.0)::double precision AS "hoursInTrade",
          COUNT(DISTINCT b."invoiceNo") FILTER (WHERE b.type = 'sale') AS invoices,
          COUNT(DISTINCT b."custCode") FILTER (WHERE b.type = 'sale' AND COALESCE(b."saleIncl", 0) > 0) AS outlets,
          COUNT(*) AS lines, COALESCE(SUM(b."saleIncl"), 0)::double precision AS "netSales", COALESCE(SUM(b.qty), 0)::double precision AS units,
          MAX(i."averageInterval") AS "averageInterval"
        FROM base b LEFT JOIN intervals i ON i.rep = b.rep AND i.date = b.date
        GROUP BY b.date, b.rep ORDER BY b.date DESC, "firstTransaction" DESC`),
      prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
        SELECT ${REP_EXPRESSION} AS rep, COUNT(DISTINCT DATE("txnDate" + ${NAIROBI_OFFSET})) AS "activeDays",
          COUNT(DISTINCT "custCode") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS outlets,
          COUNT(DISTINCT (DATE("txnDate" + ${NAIROBI_OFFSET}), "custCode")) FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS "outletDays",
          (COUNT(DISTINCT (DATE("txnDate" + ${NAIROBI_OFFSET}), "custCode")) FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0) /
            NULLIF(COUNT(DISTINCT DATE("txnDate" + ${NAIROBI_OFFSET})), 0)::double precision) AS "averageOutletsPerDay",
          COUNT(DISTINCT "invoiceNo") FILTER (WHERE type = 'sale') AS invoices,
          COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales", COALESCE(SUM(qty), 0)::double precision AS units
        FROM "UpfieldTransaction" WHERE ${where} GROUP BY 1 ORDER BY "outletDays" DESC, "netSales" DESC`),
      prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(BTRIM("custCode"), ''), 'Uncoded') AS "customerCode", COALESCE(NULLIF(BTRIM("custName"), ''), 'Unnamed outlet') AS "customerName",
          COUNT(DISTINCT DATE("txnDate" + ${NAIROBI_OFFSET})) AS "activeDays", COUNT(DISTINCT ${REP_EXPRESSION}) AS reps,
          COUNT(DISTINCT "invoiceNo") AS invoices, COALESCE(SUM("saleIncl"), 0)::double precision AS "netSales",
          COALESCE(SUM(qty), 0)::double precision AS units, MAX("txnDate" + ${NAIROBI_OFFSET}) AS "lastTransaction"
        FROM "UpfieldTransaction" WHERE ${where} AND type = 'sale' AND COALESCE("saleIncl", 0) > 0
        GROUP BY 1, 2 ORDER BY "activeDays" DESC, "netSales" DESC LIMIT 25`),
      prisma.$queryRaw<Array<{ rep: string }>>(Prisma.sql`SELECT DISTINCT ${REP_EXPRESSION} AS rep FROM "UpfieldTransaction" WHERE ${monthWhere} ORDER BY 1`),
      prisma.$queryRaw<Array<{ date: Date }>>(Prisma.sql`SELECT DISTINCT DATE("txnDate" + ${NAIROBI_OFFSET}) AS date FROM "UpfieldTransaction" WHERE ${monthWhere} ORDER BY 1 DESC`),
      prisma.syncWatermark.findUnique({ where: { bridge: "upfield-timestamps" }, select: { updatedAt: true, lastIncrementalAt: true } }),
      prisma.upfieldSyncRun.findFirst({ where: { status: "COMPLETE" }, orderBy: { completedAt: "desc" }, select: { completedAt: true, windowEnd: true, recordCount: true } }),
    ]);

    const metric = metrics[0];
    return NextResponse.json({
      scope: "Upfield · DataEdge", month,
      metrics: {
        lines: number(metric?.lines), invoices: number(metric?.invoices), outlets: number(metric?.outlets), reps: number(metric?.reps),
        netSales: metric?.netSales ?? 0, units: metric?.units ?? 0, returnsValue: metric?.returnsValue ?? 0,
        averageInterval: metric?.averageInterval ?? null, lastDataAt: iso(metric?.lastDataAt),
      },
      daily: daily.map((row) => ({ date: day(row.date), invoices: number(row.invoices), outlets: number(row.outlets), reps: number(row.reps), netSales: row.netSales, units: row.units })),
      hourly: hourly.map((row) => ({ hour: row.hour, invoices: number(row.invoices), outlets: number(row.outlets), netSales: row.netSales })),
      repDays: repDays.map((row) => ({ ...row, date: day(row.date), firstTransaction: iso(row.firstTransaction), lastTransaction: iso(row.lastTransaction), invoices: number(row.invoices), outlets: number(row.outlets), lines: number(row.lines) })),
      coverage: coverage.map((row) => ({ ...row, activeDays: number(row.activeDays), outlets: number(row.outlets), outletDays: number(row.outletDays), invoices: number(row.invoices) })),
      customers: customers.map((row) => ({ ...row, activeDays: number(row.activeDays), reps: number(row.reps), invoices: number(row.invoices), lastTransaction: iso(row.lastTransaction) })),
      filters: { reps: filterReps.map((row) => row.rep), dates: filterDates.map((row) => day(row.date)) },
      freshness: { syncedAt: iso(watermark?.updatedAt), through: iso(watermark?.lastIncrementalAt), latestRunCompletedAt: iso(latestRun?.completedAt), latestRunRows: latestRun?.recordCount ?? null },
      definitions: { coverage: "Unique customers with at least one positive sale in the selected period.", time: "First and last DataEdge sales/return transaction, converted from the stored UTC instant to Nairobi wall-clock time; this is not GPS check-in/check-out time. Upfield start status uses an 8:00 AM benchmark." },
    });
  } catch (error) {
    console.error("Failed to load Upfield Timestamp and Coverage", error);
    return NextResponse.json({ error: "Failed to load Upfield Timestamp and Coverage." }, { status: 500 });
  }
}

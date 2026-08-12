import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthRange(month: string | null) {
  const now = new Date();
  const source = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01T00:00:00.000Z` : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const start = new Date(source);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month");
  if (month && !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: '"month" must be YYYY-MM.' }, { status: 400 });
  const rep = req.nextUrl.searchParams.get("rep")?.trim() || null;
  const segment = req.nextUrl.searchParams.get("segment")?.trim() || null;
  const { start, end } = monthRange(month);
  const conditions = [Prisma.sql`"callDate" >= ${start}`, Prisma.sql`"callDate" < ${end}`];
  if (rep) conditions.push(Prisma.sql`"salesman" = ${rep}`);
  if (segment) conditions.push(Prisma.sql`segment = ${segment}`);
  const where = Prisma.join(conditions, " AND ");

  try {
    const [metrics, daily, hourly, segments, reps, filters, watermark] = await Promise.all([
      prisma.$queryRaw<Array<{ calls: bigint; productiveCalls: bigint; customers: bigint; reps: bigint; netSales: number; averageDuration: number | null }>>(Prisma.sql`
        SELECT COUNT(*) AS calls, COUNT(*) FILTER (WHERE "isProductive") AS "productiveCalls", COUNT(DISTINCT "customerName") AS customers,
          COUNT(DISTINCT salesman) AS reps, COALESCE(SUM("netSales"), 0)::double precision AS "netSales",
          AVG("durationMinutes")::double precision AS "averageDuration" FROM "EablCall" WHERE ${where}`),
      prisma.$queryRaw<Array<{ date: Date; calls: bigint; productiveCalls: bigint; netSales: number }>>(Prisma.sql`
        SELECT "callDate"::date AS date, COUNT(*) AS calls, COUNT(*) FILTER (WHERE "isProductive") AS "productiveCalls", COALESCE(SUM("netSales"), 0)::double precision AS "netSales"
        FROM "EablCall" WHERE ${where} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<Array<{ hour: number; calls: bigint; netSales: number }>>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM "timeIn")::int AS hour, COUNT(*) AS calls, COALESCE(SUM("netSales"),0)::double precision AS "netSales"
        FROM "EablCall" WHERE ${where} AND "timeIn" IS NOT NULL GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<Array<{ segment: string | null; calls: bigint; productiveCalls: bigint; netSales: number }>>(Prisma.sql`
        SELECT segment, COUNT(*) AS calls, COUNT(*) FILTER (WHERE "isProductive") AS "productiveCalls", COALESCE(SUM("netSales"),0)::double precision AS "netSales"
        FROM "EablCall" WHERE ${where} GROUP BY 1 ORDER BY "netSales" DESC`),
      prisma.$queryRaw<Array<{ salesman: string; agent: string | null; calls: bigint; productiveCalls: bigint; customers: bigint; netSales: number; averageDuration: number | null }>>(Prisma.sql`
        SELECT salesman, MAX(agent) AS agent, COUNT(*) AS calls, COUNT(*) FILTER (WHERE "isProductive") AS "productiveCalls", COUNT(DISTINCT "customerName") AS customers,
          COALESCE(SUM("netSales"),0)::double precision AS "netSales", AVG("durationMinutes")::double precision AS "averageDuration"
        FROM "EablCall" WHERE ${where} GROUP BY salesman ORDER BY "netSales" DESC, calls DESC`),
      Promise.all([prisma.eablCall.findMany({ distinct: ["salesman"], select: { salesman: true }, orderBy: { salesman: "asc" } }), prisma.eablCall.findMany({ distinct: ["segment"], select: { segment: true }, where: { segment: { not: null } }, orderBy: { segment: "asc" } })]),
      prisma.syncWatermark.findUnique({ where: { bridge: "eabl-call-performance" }, select: { updatedAt: true } }),
    ]);
    const number = (value: bigint | number | null) => value === null ? null : Number(value);
    return NextResponse.json({
      scope: "EABL-Nyeri & EABL-Nyahururu", month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      metrics: { calls: number(metrics[0]?.calls ?? 0) ?? 0, productiveCalls: number(metrics[0]?.productiveCalls ?? 0) ?? 0, customers: number(metrics[0]?.customers ?? 0) ?? 0, reps: number(metrics[0]?.reps ?? 0) ?? 0, netSales: metrics[0]?.netSales ?? 0, averageDuration: metrics[0]?.averageDuration ?? null },
      daily: daily.map((r) => ({ date: r.date.toISOString().slice(0, 10), calls: number(r.calls) ?? 0, productiveCalls: number(r.productiveCalls) ?? 0, netSales: r.netSales })),
      hourly: hourly.map((r) => ({ hour: r.hour, calls: number(r.calls) ?? 0, netSales: r.netSales })),
      segments: segments.map((r) => ({ segment: r.segment ?? "Unassigned", calls: number(r.calls) ?? 0, productiveCalls: number(r.productiveCalls) ?? 0, netSales: r.netSales })),
      reps: reps.map((r) => ({ ...r, calls: number(r.calls) ?? 0, productiveCalls: number(r.productiveCalls) ?? 0, customers: number(r.customers) ?? 0 })),
      filters: { reps: filters[0].map((r) => r.salesman), segments: filters[1].flatMap((r) => r.segment ? [r.segment] : []) },
      syncUpdatedAt: watermark?.updatedAt.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Failed to load EABL Call Performance summary", error);
    return NextResponse.json({ error: "Failed to load EABL Call Performance." }, { status: 500 });
  }
}

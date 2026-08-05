import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/** TEMPORARY diagnostic route — investigating a live "wrong/zero numbers on
 *  Daily/Weekly Targets, Sales data, Rep Performance" report. Delete once
 *  root-caused; not a permanent part of the app surface. */
export async function GET(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const monthIndex = now.getUTCMonth();

  const [
    weeklyTargetCount,
    weeklyTargetSum,
    dailyTargetCount,
    dailyTargetSum,
    dailyTargetThisMonth,
    dailySalesActualCount,
    dailySalesActualRange,
    dailySalesActualThisMonthSum,
    salesRepActualCount,
    salesRepActualMatched,
    salesRepActualSum,
    salesRepActualThisYear,
    teamLeaderAssignmentActive,
    teamLeaderAssignmentDistinctReps,
    employeeMasterCount,
    employeeMasterActive,
    repContributionCount,
  ] = await Promise.all([
    prisma.weeklyTarget.count(),
    prisma.weeklyTarget.aggregate({ _sum: { targetValue: true } }),
    prisma.dailyTarget.count(),
    prisma.dailyTarget.aggregate({ _sum: { targetValue: true } }),
    prisma.dailyTarget.count({ where: { date: { gte: new Date(Date.UTC(Number(year), monthIndex, 1)), lt: new Date(Date.UTC(Number(year), monthIndex + 1, 1)) } } }),
    prisma.dailySalesActual.count(),
    prisma.dailySalesActual.aggregate({ _min: { date: true }, _max: { date: true } }),
    prisma.dailySalesActual.aggregate({
      _sum: { revenue: true },
      where: { date: { gte: new Date(Date.UTC(Number(year), monthIndex, 1)), lt: new Date(Date.UTC(Number(year), monthIndex + 1, 1)) } },
    }),
    prisma.salesRepActual.count(),
    prisma.salesRepActual.count({ where: { employeeCode: { not: null } } }),
    prisma.salesRepActual.aggregate({ _sum: { revenue: true } }),
    prisma.salesRepActual.aggregate({ _sum: { revenue: true }, where: { year } }),
    prisma.teamLeaderAssignment.count({ where: { active: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, distinct: ["employeeCode"], select: { employeeCode: true } }).then((r) => r.length),
    prisma.employeeMaster.count(),
    prisma.employeeMaster.count({ where: { active: true } }),
    prisma.repContribution.count(),
  ]);

  const sampleUnmatchedSapNames = await prisma.salesRepActual.findMany({
    where: { employeeCode: null },
    select: { sapName: true, revenue: true, principal: true, year: true, month: true },
    orderBy: { revenue: "desc" },
    take: 10,
  });

  const sampleWeeklyTarget = await prisma.weeklyTarget.findFirst({ orderBy: { updatedAt: "desc" }, select: { teamLeaderId: true, principal: true, weekStartDate: true, targetValue: true } });
  const sampleDailyTarget = await prisma.dailyTarget.findFirst({ orderBy: { date: "desc" }, select: { employeeCode: true, principal: true, teamLeaderId: true, date: true, targetValue: true } });

  // Deep dive: DailyTarget/WeeklyTarget date sanity, bad employeeCodes, unmatched SAP names.
  const dailyTargetOutOfRange = await prisma.dailyTarget.count({
    where: { OR: [{ date: { lt: new Date(Date.UTC(2025, 0, 1)) } }, { date: { gte: new Date(Date.UTC(2027, 0, 1)) } }] },
  });
  const weeklyTargetOutOfRange = await prisma.weeklyTarget.findMany({
    where: { OR: [{ weekStartDate: { lt: new Date(Date.UTC(2025, 0, 1)) } }, { weekStartDate: { gte: new Date(Date.UTC(2027, 0, 1)) } }] },
    select: { teamLeaderId: true, principal: true, year: true, monthLabel: true, weekLabel: true, weekStartDate: true, targetValue: true },
    take: 20,
  });
  const dailyTargetByYear = await prisma.$queryRaw<{ y: number; c: bigint }[]>`
    SELECT EXTRACT(YEAR FROM date)::int AS y, COUNT(*)::bigint AS c FROM "DailyTarget" GROUP BY y ORDER BY y
  `;

  const allActiveAssignments = await prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, employeeName: true, principal: true, teamLeaderId: true } });
  const employeeMasterCodes = new Set((await prisma.employeeMaster.findMany({ select: { employeeCode: true } })).map((e) => e.employeeCode));
  const assignmentsWithUnknownEmployeeCode = allActiveAssignments.filter((a) => !employeeMasterCodes.has(a.employeeCode));
  const nonNumericEmployeeCodes = allActiveAssignments.filter((a) => !/^\d+$/.test(a.employeeCode));

  const unmatchedSalesRepGrouped = await prisma.$queryRaw<{ sapName: string; c: bigint; rev: number }[]>`
    SELECT "sapName", COUNT(*)::bigint AS c, SUM(revenue)::double precision AS rev
    FROM "SalesRepActual" WHERE "employeeCode" IS NULL
    GROUP BY "sapName" ORDER BY rev DESC LIMIT 20
  `;
  const employeeMasterSapNames = await prisma.employeeMaster.findMany({ select: { sapName: true, employeeCode: true, pineName: true } });

  return NextResponse.json({
    currentPeriod: { year, monthIndex },
    weeklyTarget: { count: weeklyTargetCount, sumTargetValue: weeklyTargetSum._sum.targetValue },
    dailyTarget: { count: dailyTargetCount, sumTargetValue: dailyTargetSum._sum.targetValue, thisMonthCount: dailyTargetThisMonth },
    dailySalesActual: {
      count: dailySalesActualCount,
      minDate: dailySalesActualRange._min.date,
      maxDate: dailySalesActualRange._max.date,
      thisMonthRevenueSum: dailySalesActualThisMonthSum._sum.revenue,
    },
    salesRepActual: {
      count: salesRepActualCount,
      matchedToEmployeeCode: salesRepActualMatched,
      unmatchedCount: salesRepActualCount - salesRepActualMatched,
      revenueSumAll: salesRepActualSum._sum.revenue,
      revenueSumThisYear: salesRepActualThisYear._sum.revenue,
    },
    teamLeaderAssignment: { activeCount: teamLeaderAssignmentActive, distinctActiveReps: teamLeaderAssignmentDistinctReps },
    employeeMaster: { total: employeeMasterCount, active: employeeMasterActive },
    repContributionCount,
    sampleUnmatchedSapNames,
    sampleWeeklyTarget,
    sampleDailyTarget,
    dailyTargetOutOfRange,
    weeklyTargetOutOfRange,
    dailyTargetByYear: dailyTargetByYear.map((r) => ({ year: r.y, count: Number(r.c) })),
    assignmentsWithUnknownEmployeeCode,
    nonNumericEmployeeCodes,
    unmatchedSalesRepGrouped: unmatchedSalesRepGrouped.map((r) => ({ sapName: r.sapName, count: Number(r.c), revenue: r.rev })),
    employeeMasterSapNames,
  });
}

// Reads the facts behind the coaching performance feed (see coachingPerformanceFeed.ts).
// The SQL follows the same shapes lib/performanceTracker/autoPopulate.ts already uses
// against SalesRepActual and RepCall, grouped per rep instead of summed company-wide.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { foldSapRowsByName } from "@/lib/coachingRepActivity";
import {
  asOfDate,
  recentPeriods,
  shapeRepPerformance,
  type RepCallFact,
  type RepCallVolumeFact,
  type RepPerformanceRow,
  type RepSalesFact,
  type RepTargetFact,
} from "@/lib/coachingPerformanceFeed";

export const PERFORMANCE_FEED_MONTHS = 2;

export async function loadCoachingPerformance(now = new Date(), months = PERFORMANCE_FEED_MONTHS) {
  const employees = await prisma.employeeMaster.findMany({ where: { active: true }, select: { employeeCode: true, pineName: true, sapName: true } });
  const employeeCodes = new Set(employees.map((e) => e.employeeCode));

  const periods = recentPeriods(now, months);
  const rows: RepPerformanceRow[] = [];
  for (const period of periods) {
    const [yearText, monthText] = period.split("-");
    const monthIndex = Number(monthText) - 1;
    const monthName = CANONICAL_MONTHS[monthIndex] ?? monthText;
    const start = new Date(Date.UTC(Number(yearText), monthIndex, 1));
    const end = new Date(Date.UTC(Number(yearText), monthIndex + 1, 1));
    const asOf = asOfDate(period, now);
    const asOfEnd = new Date(Date.parse(`${asOf}T00:00:00Z`) + 24 * 3600 * 1000); // exclusive upper bound

    const [salesRows, calls, targets, callVolumes] = await Promise.all([
      // Rows with no employee code (the SAP salesperson name did not match the roster) are attributed by name, as Rep Performance does.
      prisma.$queryRaw<{ employeeCode: string | null; sapName: string; cases: number; revenue: number }[]>(Prisma.sql`
        SELECT "employeeCode", "sapName", SUM(cases)::float AS cases, SUM(revenue)::float AS revenue
        FROM "SalesRepActual"
        WHERE year = ${yearText} AND month = ${monthName}
        GROUP BY "employeeCode", "sapName"
      `),
      prisma.$queryRaw<RepCallFact[]>(Prisma.sql`
        SELECT "employeeCode",
               COUNT(*)::int AS "callsMade",
               COUNT(*) FILTER (WHERE "callOutcome" = 'Sale')::int AS "productiveCalls",
               COUNT(DISTINCT date)::int AS "daysWorked"
        FROM "RepCall"
        WHERE date >= ${start} AND date < ${end}
        GROUP BY "employeeCode"
      `),
      prisma.$queryRaw<RepTargetFact[]>(Prisma.sql`
        SELECT "employeeCode",
               SUM("targetValue")::float AS "monthTarget",
               COALESCE(SUM("targetValue") FILTER (WHERE date < ${asOfEnd}), 0)::float AS "targetToDate"
        FROM "DailyTarget"
        WHERE date >= ${start} AND date < ${end}
        GROUP BY "employeeCode"
      `),
      // Cases from the rep's own calls: the fallback for reps with no SAP-reconciled sales row.
      prisma.$queryRaw<RepCallVolumeFact[]>(Prisma.sql`
        SELECT "employeeCode",
               SUM(cases) FILTER (WHERE cases IS NOT NULL)::float AS cases,
               COUNT(*) FILTER (WHERE qty > 0)::int AS "callsWithQty",
               COUNT(*) FILTER (WHERE qty > 0 AND cases IS NOT NULL)::int AS "callsWithCases"
        FROM "RepCall"
        WHERE date >= ${start} AND date < ${end}
        GROUP BY "employeeCode"
      `),
    ]);

    // One "day" per month here: the fold adds the rows up per employee code.
    const sales: RepSalesFact[] = foldSapRowsByName(salesRows.map((r) => ({ ...r, date: period })), employees).map((r) => ({ employeeCode: r.employeeCode, cases: r.cases, revenue: r.revenue }));
    rows.push(...shapeRepPerformance({ period, asOf, employeeCodes, sales, calls, targets, callVolumes }));
  }
  return { periods, rows };
}

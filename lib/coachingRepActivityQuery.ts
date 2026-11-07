// Reads the facts behind the rep activity feed (see coachingRepActivity.ts).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getJpAdherenceSummary } from "@/lib/jpAdherence";
import { shapeRepActivity, type RepActivity, type RepCallDayFact, type RepJpFact, type RepSapDayFact } from "@/lib/coachingRepActivity";

export const MAX_ACTIVITY_CODES = 8;
export const MAX_ACTIVITY_DAYS = 400;

/** `start` is the first day, `endExclusive` the day after the last (both UTC midnight). */
export async function loadRepActivity(codes: string[], start: Date, endExclusive: Date): Promise<RepActivity[]> {
  const [sap, calls] = await Promise.all([
    prisma.$queryRaw<RepSapDayFact[]>(Prisma.sql`
      SELECT "employeeCode", to_char(date, 'YYYY-MM-DD') AS date, SUM(cases)::float AS cases, SUM(revenue)::float AS revenue
      FROM "DailySalesRepActual"
      WHERE "employeeCode" IN (${Prisma.join(codes)}) AND date >= ${start} AND date < ${endExclusive}
      GROUP BY "employeeCode", date
    `),
    prisma.$queryRaw<RepCallDayFact[]>(Prisma.sql`
      SELECT "employeeCode", to_char(date, 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS calls,
             COUNT(*) FILTER (WHERE "callOutcome" = 'Sale')::int AS "productiveCalls",
             COALESCE(SUM(sales), 0)::float AS sales,
             SUM(cases) FILTER (WHERE cases IS NOT NULL)::float AS cases,
             COUNT(*) FILTER (WHERE qty > 0)::int AS "callsWithQty",
             COUNT(*) FILTER (WHERE qty > 0 AND cases IS NOT NULL)::int AS "callsWithCases",
             COALESCE(SUM(cardinality(string_to_array(NULLIF(btrim("costCentresBought"), ''), ','))) FILTER (WHERE "callOutcome" = 'Sale'), 0)::int AS lines
      FROM "RepCall"
      WHERE "employeeCode" IN (${Prisma.join(codes)}) AND date >= ${start} AND date < ${endExclusive}
      GROUP BY "employeeCode", date
    `),
  ]);

  // The journey plan figures come from the page's own query, one rep at a time (a handful of codes at most).
  const jp: RepJpFact[] = [];
  for (const employeeCode of codes) {
    try {
      const summary = await getJpAdherenceSummary({ start, end: endExclusive }, null, {
        principalKey: null, date: null, dayNames: null, roleFilter: "all", employeeCode, teamLeader: null,
      });
      const k = summary.kpis;
      jp.push({ employeeCode, outletsPlanned: k.outletsPlanned, outletsVisited: k.outletsVisited, plannedNotVisited: k.plannedNotVisited, jpAdherencePct: k.jpAdherencePct });
    } catch {
      // No journey plan figures for this rep: the rest of the answer is still good.
    }
  }

  return shapeRepActivity({ codes, sap, calls, jp });
}

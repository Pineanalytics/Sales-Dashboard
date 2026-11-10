// Reads the facts behind the rep activity feed (see coachingRepActivity.ts).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getJpAdherenceSummary } from "@/lib/jpAdherence";
import { foldSapRowsByName, nameKey, shapeRepActivity, type RepActivity, type RepCallDayFact, type RepJpFact, type SapRowByName } from "@/lib/coachingRepActivity";

export const MAX_ACTIVITY_CODES = 8;
export const MAX_ACTIVITY_DAYS = 400;

/** `start` is the first day, `endExclusive` the day after the last (both UTC midnight). */
export async function loadRepActivity(codes: string[], start: Date, endExclusive: Date): Promise<RepActivity[]> {
  // SAP rows the sync could not match to the roster carry no employee code; they are picked up by the rep's roster names, as Rep Performance does.
  const employees = await prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true } });
  const mine = employees.filter((e) => codes.includes(e.employeeCode));
  const myKeys = [...new Set(mine.flatMap((e) => [nameKey(e.pineName), nameKey(e.sapName)]).filter(Boolean))];
  const byNameWhere = myKeys.length > 0 ? Prisma.sql`("employeeCode" IS NULL AND lower(regexp_replace(btrim("sapName"), '[^a-zA-Z0-9]', '', 'g')) IN (${Prisma.join(myKeys)}))` : Prisma.sql`FALSE`;

  const [sapRows, calls] = await Promise.all([
    prisma.$queryRaw<SapRowByName[]>(Prisma.sql`
      SELECT "employeeCode", "sapName", to_char(date, 'YYYY-MM-DD') AS date, SUM(cases)::float AS cases, SUM(revenue)::float AS revenue
      FROM "DailySalesRepActual"
      WHERE ("employeeCode" IN (${Prisma.join(codes)}) OR ${byNameWhere}) AND date >= ${start} AND date < ${endExclusive}
      GROUP BY "employeeCode", "sapName", date
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

  const sap = foldSapRowsByName(sapRows, employees).filter((r) => codes.includes(r.employeeCode));
  return shapeRepActivity({ codes, sap, calls, jp });
}

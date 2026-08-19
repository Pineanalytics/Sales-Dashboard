// Pulls "actual" values for whichever metrics have a live source (see
// definitions.ts's `autoSource` field) — Revenue/GP from SalesRepActual (the
// same SAP-sourced rep-grain table used elsewhere in this dashboard),
// Coverage/Distribution and Calls Made/Productive/Active Reps from
// ActiveOutlet/RepCall (the same tables JP Adherence and Active Outlets
// already read). Only ever fills `actual` — targets are always a planning
// input, never something this dashboard derives, matching both source
// workbooks' own convention (Target is manually entered, Actual is what
// ideally comes from live systems).
//
// teamLeaderScope null = company-wide (the HOD tracker); non-null narrows to
// that Team Leader's own employeeCodes (the TL tracker) — the exact same
// TeamLeaderScope object every other Prisma-backed route in this app already
// uses, via lib/teamLeaderScope.ts's loadTeamLeaderScope.

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { AutoSourceKey } from "./definitions";

const EMPTY_SQL = Prisma.sql``;

export interface AutoPopulateScope {
  employeeCodes: string[];
}

function monthWindow(periodMonth: string): { start: Date; end: Date; year: string; monthName: string } {
  const [yearStr, monthStr] = periodMonth.split("-");
  const monthIndex = Number(monthStr) - 1;
  return {
    start: new Date(Date.UTC(Number(yearStr), monthIndex, 1)),
    end: new Date(Date.UTC(Number(yearStr), monthIndex + 1, 1)),
    year: yearStr,
    monthName: CANONICAL_MONTHS[monthIndex] ?? monthStr,
  };
}

/** Live "actual" values for every auto-sourced metric, for the given period
 *  and (optional) Team Leader scope. Returns only the keys it could resolve —
 *  callers should merge these into existing metric rows without clobbering
 *  anything a metric already has (see the API route's own merge logic), so a
 *  manual override always wins once someone's actually typed one in. */
export async function autoPopulateActuals(
  periodMonth: string,
  scope: AutoPopulateScope | null
): Promise<Partial<Record<AutoSourceKey, number>>> {
  const { start, end, year, monthName } = monthWindow(periodMonth);
  const codes = scope?.employeeCodes ?? null;

  const salesClause = codes ? (codes.length > 0 ? Prisma.sql`AND "employeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`AND false`) : EMPTY_SQL;
  const repCallClause = codes ? (codes.length > 0 ? Prisma.sql`AND "employeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`AND false`) : EMPTY_SQL;
  const outletClause = codes ? (codes.length > 0 ? Prisma.sql`AND "pjpEmployeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`AND false`) : EMPTY_SQL;

  const [salesRows, repCallRows, outletRows] = await Promise.all([
    prisma.$queryRaw<{ revenue: number | null; grossProfit: number | null }[]>(Prisma.sql`
      SELECT SUM(revenue)::float AS revenue, SUM("grossProfit")::float AS "grossProfit"
      FROM "SalesRepActual"
      WHERE year = ${year} AND month = ${monthName}
      ${salesClause}
    `),
    prisma.$queryRaw<{ callsMade: number; productiveCalls: number; activeReps: number }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT "outletId")::int AS "callsMade",
        COUNT(DISTINCT "outletId") FILTER (WHERE "callOutcome" = 'Sale')::int AS "productiveCalls",
        COUNT(DISTINCT "employeeCode")::int AS "activeReps"
      FROM "RepCall"
      WHERE date >= ${start} AND date < ${end}
      ${repCallClause}
    `),
    prisma.$queryRaw<{ total: number; withDistribution: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'Active')::int AS "withDistribution"
      FROM "ActiveOutlet"
      WHERE year = ${year}
      ${outletClause}
    `),
  ]);

  const sales = salesRows[0];
  const repCall = repCallRows[0];
  const outlet = outletRows[0];

  const result: Partial<Record<AutoSourceKey, number>> = {};
  if (sales?.revenue != null) result.revenueActual = sales.revenue;
  if (sales?.grossProfit != null) result.gpActual = sales.grossProfit;
  if (repCall) {
    result.callsMade = repCall.callsMade;
    result.productiveCalls = repCall.productiveCalls;
    result.activeSalesReps = repCall.activeReps;
  }
  if (outlet) {
    result.totalOutletUniverse = outlet.total;
    result.outletsWithDistribution = outlet.withDistribution;
  }
  return result;
}

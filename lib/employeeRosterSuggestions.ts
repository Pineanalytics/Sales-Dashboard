import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface TimestampRosterSuggestion {
  employeeCode: string;
  salesRep: string;
  suggestedPrincipal: string;
  productiveCalls: number;
  sales: number;
  latestCallDate: Date;
}

/**
 * New timestamp reps do not get silently assigned. This worklist only proposes the
 * absolute principal they sold most often over the last 90 days, so a roster editor
 * can review and explicitly accept or amend the mapping before it affects reporting.
 */
export async function getTimestampRosterSuggestions(principals?: string[]): Promise<TimestampRosterSuggestion[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const rows = await prisma.$queryRaw<TimestampRosterSuggestion[]>(Prisma.sql`
    WITH principal_activity AS (
      SELECT
        r."employeeCode",
        MAX(r."salesRep") AS "salesRep",
        BTRIM(cost_centre."value") AS "suggestedPrincipal",
        COUNT(*)::integer AS "productiveCalls",
        COALESCE(SUM(r.sales), 0)::double precision AS sales,
        MAX(r.date) AS "latestCallDate",
        ROW_NUMBER() OVER (
          PARTITION BY r."employeeCode"
          ORDER BY COUNT(*) DESC, COALESCE(SUM(r.sales), 0) DESC, MAX(r.date) DESC, BTRIM(cost_centre."value") ASC
        ) AS rank
      FROM "RepCall" r
      LEFT JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"
      CROSS JOIN LATERAL unnest(string_to_array(r."costCentresBought", ',')) AS cost_centre("value")
      WHERE em.id IS NULL
        AND r.date >= ${since}
        AND r."callOutcome" = 'Sale'
        AND BTRIM(cost_centre."value") <> ''
      GROUP BY r."employeeCode", BTRIM(cost_centre."value")
    )
    SELECT "employeeCode", "salesRep", "suggestedPrincipal", "productiveCalls", sales, "latestCallDate"
    FROM principal_activity
    WHERE rank = 1
    ORDER BY "latestCallDate" DESC, "productiveCalls" DESC, sales DESC
  `);

  const allowed = principals?.length ? new Set(principals) : null;
  return rows.filter((row) => !allowed || allowed.has(row.suggestedPrincipal));
}

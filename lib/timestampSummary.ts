import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";

export type TimestampRoleFilter = "all" | "Primary Sales" | "Secondary Sales";
export type TimestampChartGranularity = "Hourly" | "Daily" | "Weekly";

export interface TimestampFilters {
  principalKey: string | null;
  date: Date | null;
  employeeCode: string | null;
  region: string | null;
  roleFilter: TimestampRoleFilter;
  chartGranularity: TimestampChartGranularity;
}

export interface TimestampRoleStats {
  totalCalls: number;
  productiveCalls: number;
  strikeRate: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  sales: number;
}

export interface TimestampRepDaySummary {
  date: string;
  employeeCode: string;
  salesRep: string;
  region: string;
  salesRole: string;
  firstCall: string;
  lastCall: string;
  hoursInDay: number;
  callsMade: number;
  productiveCalls: number;
  strikeRatePct: number;
  outletsCovered: number;
  avgIntervalMins: number | null;
  sales: number;
}

export interface TimestampChartRow {
  bucket: number | string;
  salesRole: string;
  calls: number;
}

export interface TimestampSummaryData {
  availableDates: string[];
  availableReps: { employeeCode: string; salesRep: string }[];
  availableRegions: string[];
  primaryStats: TimestampRoleStats;
  secondaryStats: TimestampRoleStats;
  overall: TimestampRoleStats;
  summaries: TimestampRepDaySummary[];
  chartRows: TimestampChartRow[];
}

type SummaryRow = TimestampRepDaySummary;
interface RepRow { employeeCode: string; salesRep: string }
interface DateRow { date: string }
interface RegionRow { region: string }
interface MetricRow extends TimestampRoleStats { salesRole: string | null }
type ChartRow = TimestampChartRow;

const EMPTY_SQL = Prisma.sql``;

function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function nextUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** Produces a direct source relation and predicates for the dashboard's
 * aggregate queries. This deliberately avoids a wide MATERIALIZED CTE: on
 * the VPS, repeatedly reading that temporary relation was markedly slower
 * than independent grouped scans of the indexed RepCall table. */
function sourceQuery(now: Date, scope: TeamLeaderScope | null, principalKey: string | null): { from: Prisma.Sql; baseWhere: Prisma.Sql } {
  const { start, end } = monthWindow(now);
  const teamClause = scope
    ? scope.employeeCodes.length > 0
      ? Prisma.sql`AND r."employeeCode" IN (${Prisma.join(scope.employeeCodes)})`
      : Prisma.sql`AND false`
    : EMPTY_SQL;

  if (!principalKey) {
    return {
      from: Prisma.sql`FROM "RepCall" r`,
      baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} ${teamClause}`,
    };
  }

  return {
    from: Prisma.sql`
      FROM "RepCall" r
      INNER JOIN (
        SELECT DISTINCT p.date, p."employeeCode"
        FROM "RepCall" p
        WHERE p.date >= ${start} AND p.date < ${end}
          AND string_to_array(COALESCE(p."costCentresBought", ''), ', ') @> ARRAY[${principalKey}]::text[]
      ) relevant_rep_days
        ON relevant_rep_days.date = r.date AND relevant_rep_days."employeeCode" = r."employeeCode"
    `,
    baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} ${teamClause}`,
  };
}

function selectedDateClause(filters: TimestampFilters): Prisma.Sql {
  return filters.date ? Prisma.sql`AND r.date >= ${filters.date} AND r.date < ${nextUtcDay(filters.date)}` : EMPTY_SQL;
}

function selectedRepClause(filters: TimestampFilters): Prisma.Sql {
  return filters.employeeCode ? Prisma.sql`AND r."employeeCode" = ${filters.employeeCode}` : EMPTY_SQL;
}

function selectedRegionClause(filters: TimestampFilters): Prisma.Sql {
  return filters.region ? Prisma.sql`AND COALESCE(NULLIF(BTRIM(r.region), ''), 'Unassigned') = ${filters.region}` : EMPTY_SQL;
}

function selectedRoleClause(filters: TimestampFilters): Prisma.Sql {
  return filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND r."salesRole" = ${filters.roleFilter}`;
}

function chartBucket(granularity: TimestampChartGranularity): Prisma.Sql {
  if (granularity === "Daily") return Prisma.sql`to_char(r.date, 'YYYY-MM-DD')`;
  if (granularity === "Weekly") return Prisma.sql`CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer`;
  return Prisma.sql`EXTRACT(HOUR FROM r."callTime" AT TIME ZONE 'Africa/Nairobi')::integer`;
}

function emptyStats(): TimestampRoleStats {
  return { totalCalls: 0, productiveCalls: 0, strikeRate: 0, outletsCovered: 0, avgIntervalMins: null, sales: 0 };
}

/** Compact aggregate payload for the interactive Timestamps dashboard. Raw
 * RepCall detail stays in Postgres, while the browser receives only KPI,
 * chart, filter, and rep-day rows (roughly 3k rather than 94k records). */
export async function getTimestampSummary(
  now: Date,
  scope: TeamLeaderScope | null,
  filters: TimestampFilters
): Promise<TimestampSummaryData> {
  const { from, baseWhere } = sourceQuery(now, scope, filters.principalKey);
  const dateClause = selectedDateClause(filters);
  const repClause = selectedRepClause(filters);
  const regionClause = selectedRegionClause(filters);
  const roleClause = selectedRoleClause(filters);
  const salesExpression = filters.principalKey
    ? Prisma.sql`CASE WHEN string_to_array(COALESCE(r."costCentresBought", ''), ', ') @> ARRAY[${filters.principalKey}]::text[] THEN r.sales ELSE 0 END`
    : Prisma.sql`r.sales`;
  const bucket = chartBucket(filters.chartGranularity);

  const [dateRows, regionRows, repRows, summaryRows, metricRows, chartRows] = await Promise.all([
    prisma.$queryRaw<DateRow[]>(Prisma.sql`
      SELECT DISTINCT to_char(r.date, 'YYYY-MM-DD') AS date
      ${from} ${baseWhere}
      ORDER BY date
    `),
    prisma.$queryRaw<RegionRow[]>(Prisma.sql`
      SELECT DISTINCT COALESCE(NULLIF(BTRIM(r.region), ''), 'Unassigned') AS region
      ${from} ${baseWhere} ${dateClause} ${roleClause}
      ORDER BY region
    `),
    prisma.$queryRaw<RepRow[]>(Prisma.sql`
      SELECT r."employeeCode" AS "employeeCode", MAX(r."salesRep") AS "salesRep"
      ${from} ${baseWhere} ${dateClause} ${regionClause} ${roleClause}
      GROUP BY r."employeeCode"
      ORDER BY "salesRep"
    `),
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        to_char(r.date, 'YYYY-MM-DD') AS date,
        r."employeeCode" AS "employeeCode",
        MAX(r."salesRep") AS "salesRep",
        MAX(r.region) AS region,
        r."salesRole" AS "salesRole",
        MIN(r."callTime") AS "firstCall",
        MAX(r."callTime") AS "lastCall",
        ROUND((EXTRACT(EPOCH FROM MAX(r."callTime") - MIN(r."callTime")) / 3600)::numeric, 2)::double precision AS "hoursInDay",
        COUNT(*)::integer AS "callsMade",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision AS "strikeRatePct",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${roleClause}
      GROUP BY r.date, r."employeeCode", r."salesRole"
      ORDER BY date, "salesRep", "salesRole"
    `),
    prisma.$queryRaw<MetricRow[]>(Prisma.sql`
      SELECT
        CASE WHEN GROUPING(r."salesRole") = 1 THEN NULL ELSE r."salesRole" END AS "salesRole",
        COUNT(*)::integer AS "totalCalls",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        COALESCE(ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision, 0) AS "strikeRate",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${roleClause}
      GROUP BY GROUPING SETS ((r."salesRole"), ())
    `),
    prisma.$queryRaw<ChartRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, r."salesRole" AS "salesRole", COUNT(*)::integer AS calls
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${roleClause}
      GROUP BY 1, r."salesRole"
      ORDER BY bucket, "salesRole"
    `),
  ]);

  const primaryStats = metricRows.find((row) => row.salesRole === "Primary Sales") ?? emptyStats();
  const secondaryStats = metricRows.find((row) => row.salesRole === "Secondary Sales") ?? emptyStats();
  const overall = metricRows.find((row) => row.salesRole === null) ?? emptyStats();
  return {
    availableDates: dateRows.map((row) => row.date),
    availableRegions: regionRows.map((row) => row.region),
    availableReps: repRows,
    primaryStats,
    secondaryStats,
    overall,
    summaries: summaryRows,
    chartRows,
  };
}

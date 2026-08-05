import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";

export type TimestampRoleFilter = "all" | "Primary Sales" | "Secondary Sales";
export type TimestampChartGranularity = "Hourly" | "Daily" | "Weekly";

export interface TimestampFilters {
  principalKey: string | null;
  /** "YYYY-MM"; null defaults to the current calendar month. */
  month: string | null;
  date: Date | null;
  employeeCode: string | null;
  region: string | null;
  /** Employee Roaster's EmployeeMaster.teamLeader free-text value. */
  teamLeader: string | null;
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
  availableTeamLeaders: string[];
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
interface TeamLeaderRow { teamLeader: string }
interface MetricRow extends TimestampRoleStats { salesRole: string | null }
type ChartRow = TimestampChartRow;

const EMPTY_SQL = Prisma.sql``;

function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** "YYYY-MM" -> that month's [start, end) window. Falls back to the current
 * month for a missing/malformed value rather than throwing, since this only
 * ever reaches here after the API route's own regex validation. */
function resolveMonthWindow(now: Date, month: string | null): { start: Date; end: Date } {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return monthWindow(now);
  const [year, mon] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(year, mon - 1, 1)), end: new Date(Date.UTC(year, mon, 1)) };
}

function nextUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** The global principal selector uses this normalized brand key, whereas
 * Timestamps stores the full Cost Centre name (for example, `Mars-Nairobi`). */
export function timestampPrincipalKey(principalKey: string): string {
  return normalizePrincipalKey(principalKey);
}

/** Tests the canonical absolute principal from Employee Roaster. Timestamps
 * are an operational Pine report, so a rep's complete day belongs to the one
 * absolute principal rather than being reassigned according to a call's sale
 * cost-centre or their multi-principal JPA contribution allocation. */
function absolutePrincipalMatchClause(principalKey: string, absolutePrincipal: Prisma.Sql): Prisma.Sql {
  const selectorKey = timestampPrincipalKey(principalKey);
  return Prisma.sql`
    lower(regexp_replace(split_part(BTRIM(${absolutePrincipal}), '-', 1), '[^a-zA-Z0-9]', '', 'g')) = ${selectorKey}
  `;
}

/** Produces a direct source relation and predicates for the dashboard's
 * aggregate queries. This deliberately avoids a wide MATERIALIZED CTE: on
 * the VPS, repeatedly reading that temporary relation was markedly slower
 * than independent grouped scans of the indexed RepCall table. */
function sourceQuery(
  monthRange: { start: Date; end: Date },
  scope: TeamLeaderScope | null,
  principalKey: string | null
): { from: Prisma.Sql; baseWhere: Prisma.Sql; salesRole: Prisma.Sql } {
  const { start, end } = monthRange;
  const teamClause = scope
    ? scope.employeeCodes.length > 0
      ? Prisma.sql`AND r."employeeCode" IN (${Prisma.join(scope.employeeCodes)})`
      : Prisma.sql`AND false`
    : EMPTY_SQL;

  if (!principalKey) {
    return {
      // Keep an unmatched historical Pine rep visible, but use the Employee
      // Roaster's active flag and sales role whenever a master row exists.
      from: Prisma.sql`FROM "RepCall" r LEFT JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"`,
      baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} AND COALESCE(em.active, true) ${teamClause}`,
      salesRole: Prisma.sql`COALESCE(NULLIF(BTRIM(em."salesRole"), ''), r."salesRole")`,
    };
  }

  // Principal-scoped Timestamps always use the roster's absolute principal.
  // This includes every call in a matching rep-day (not only sales calls),
  // which keeps first/last-call time and coverage meaningful.
  const absolutePrincipalMatch = absolutePrincipalMatchClause(principalKey, Prisma.sql`em."absolutePrincipal"`);
  return {
    from: Prisma.sql`FROM "RepCall" r INNER JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"`,
    baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} AND em.active AND ${absolutePrincipalMatch} ${teamClause}`,
    salesRole: Prisma.sql`em."salesRole"`,
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

function selectedTeamLeaderClause(filters: TimestampFilters): Prisma.Sql {
  return filters.teamLeader ? Prisma.sql`AND em."teamLeader" = ${filters.teamLeader}` : EMPTY_SQL;
}

/**
 * A principal-scoped Timestamps view keeps the rep's full working day so that
 * first/last-call time remains meaningful.  Its role must nevertheless be
 * determined by the selected principal, not by the individual no-sale call:
 * a TDR who sells Mars is Secondary for that whole Mars rep-day, including
 * calls which naturally have no cost centre of their own.
 */
export function principalScopedSalesRole(
  employeeGroup: string,
  employeeCode: string,
  principalKey: string | null,
  storedSalesRole: string
): string {
  if (!principalKey) return storedSalesRole;

  const group = employeeGroup.trim().toUpperCase();
  if (group === "DSR" && (employeeCode.trim() === "1172" || employeeCode.trim() === "1032")) {
    return "Secondary Sales";
  }
  if (group === "TDR" && principalKey.trim().toLowerCase().startsWith("mars")) {
    return "Secondary Sales";
  }
  return ["DSR", "TDR", "KAMS", "ADMIN"].includes(group) ? "Primary Sales" : "Secondary Sales";
}

function principalScopedSalesRoleExpression(principalKey: string | null): Prisma.Sql {
  if (!principalKey) return Prisma.sql`r."salesRole"`;

  const selectedMars = timestampPrincipalKey(principalKey) === "mars";
  return Prisma.sql`
    CASE
      WHEN UPPER(BTRIM(r."employeeGroup")) = 'DSR' AND BTRIM(r."employeeCode") IN ('1172', '1032') THEN 'Secondary Sales'
      WHEN UPPER(BTRIM(r."employeeGroup")) = 'TDR' AND ${selectedMars} THEN 'Secondary Sales'
      WHEN UPPER(BTRIM(r."employeeGroup")) IN ('DSR', 'TDR', 'KAMS', 'ADMIN') THEN 'Primary Sales'
      ELSE 'Secondary Sales'
    END
  `;
}

function selectedRoleClause(filters: TimestampFilters, salesRole: Prisma.Sql): Prisma.Sql {
  return filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND ${salesRole} = ${filters.roleFilter}`;
}

function chartBucket(granularity: TimestampChartGranularity): Prisma.Sql {
  if (granularity === "Daily") return Prisma.sql`to_char(r.date, 'YYYY-MM-DD')`;
  if (granularity === "Weekly") return Prisma.sql`CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer`;
  // "callTime" is a naive `timestamp` column holding a genuine UTC instant
  // (same convention as lib/timeManagement.ts's nairobiMinutesAfterMidnight:
  // UTC hour + 3 = Nairobi wall-clock). Postgres's `AT TIME ZONE` on a naive
  // column does the OPPOSITE conversion — it treats the value as already
  // being Nairobi-local and subtracts 3h to reach UTC, which silently shifted
  // every hourly bucket backward by 3 hours (an 8am first call bucketed at
  // 2am). A plain interval add matches the established convention exactly.
  return Prisma.sql`EXTRACT(HOUR FROM (r."callTime" + INTERVAL '3 hours'))::integer`;
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
  const { from, baseWhere, salesRole } = sourceQuery(resolveMonthWindow(now, filters.month), scope, filters.principalKey);
  const dateClause = selectedDateClause(filters);
  const repClause = selectedRepClause(filters);
  const regionClause = selectedRegionClause(filters);
  const teamLeaderClause = selectedTeamLeaderClause(filters);
  const roleClause = selectedRoleClause(filters, salesRole);
  const salesExpression = Prisma.sql`r.sales`;
  const bucket = chartBucket(filters.chartGranularity);

  const [dateRows, regionRows, teamLeaderRows, repRows, summaryRows, metricRows, chartRows] = await Promise.all([
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
    prisma.$queryRaw<TeamLeaderRow[]>(Prisma.sql`
      SELECT DISTINCT em."teamLeader" AS "teamLeader"
      ${from} ${baseWhere} ${dateClause} ${roleClause}
      AND em."teamLeader" IS NOT NULL
      ORDER BY "teamLeader"
    `),
    prisma.$queryRaw<RepRow[]>(Prisma.sql`
      SELECT r."employeeCode" AS "employeeCode", MAX(r."salesRep") AS "salesRep"
      ${from} ${baseWhere} ${dateClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY r."employeeCode"
      ORDER BY "salesRep"
    `),
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        to_char(r.date, 'YYYY-MM-DD') AS date,
        r."employeeCode" AS "employeeCode",
        MAX(r."salesRep") AS "salesRep",
        MAX(r.region) AS region,
        ${salesRole} AS "salesRole",
        MIN(r."callTime") AS "firstCall",
        MAX(r."callTime") AS "lastCall",
        ROUND((EXTRACT(EPOCH FROM MAX(r."callTime") - MIN(r."callTime")) / 3600)::numeric, 2)::double precision AS "hoursInDay",
        COUNT(*)::integer AS "callsMade",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision AS "strikeRatePct",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY r.date, r."employeeCode", ${salesRole}
      ORDER BY date, "salesRep", "salesRole"
    `),
    prisma.$queryRaw<MetricRow[]>(Prisma.sql`
      SELECT
        CASE WHEN GROUPING(${salesRole}) = 1 THEN NULL ELSE ${salesRole} END AS "salesRole",
        COUNT(*)::integer AS "totalCalls",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        COALESCE(ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision, 0) AS "strikeRate",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY GROUPING SETS ((${salesRole}), ())
    `),
    prisma.$queryRaw<ChartRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, ${salesRole} AS "salesRole", COUNT(*)::integer AS calls
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY 1, 2
      ORDER BY bucket, "salesRole"
    `),
  ]);

  const primaryStats = metricRows.find((row) => row.salesRole === "Primary Sales") ?? emptyStats();
  const secondaryStats = metricRows.find((row) => row.salesRole === "Secondary Sales") ?? emptyStats();
  const overall = metricRows.find((row) => row.salesRole === null) ?? emptyStats();
  return {
    availableDates: dateRows.map((row) => row.date),
    availableRegions: regionRows.map((row) => row.region),
    availableTeamLeaders: teamLeaderRows.map((row) => row.teamLeader),
    availableReps: repRows,
    primaryStats,
    secondaryStats,
    overall,
    summaries: summaryRows,
    chartRows,
  };
}

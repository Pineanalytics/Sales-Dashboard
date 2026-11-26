import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";
import { kenyaPublicHolidaysInRange } from "@/lib/kenyaBusinessCalendar";

export type TimestampRoleFilter = "all" | "Primary Sales" | "Secondary Sales";
export type TimestampChartGranularity = "Hourly" | "Daily" | "Weekly";

export interface TimestampFilters {
  principalKey: string | null;
  /** "YYYY-MM"; null defaults to the current calendar month. */
  month: string | null;
  date: Date | null;
  employeeCode: string | null;
  region: string | null;
  /** Employee Roaster's EmployeeMaster.teamLeader free-text value, or the
   *  literal "General" sentinel for a rep with no EmployeeMaster row (or a
   *  blank teamLeader on one that exists) — see selectedTeamLeaderClause. */
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
  qty: number;
  /** Null if a productive call is missing product UOM data. */
  cases: number | null;
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
  qty: number;
  cases: number | null;
}

export interface TimestampChartRow {
  bucket: number | string;
  salesRole: string;
  calls: number;
}

/** A rep with real Timestamps activity but no EmployeeMaster row at all
 *  (confirmed live: employee 1192, 63 real calls this month, zero roster row
 *  anywhere) — not silently dropped, surfaced here so whoever maintains the
 *  roster has a direct worklist instead of a gap only discoverable by SQL. */
export interface UnmappedTimestampEmployee {
  employeeCode: string;
  salesRep: string;
  callsThisMonth: number;
  /** Temporary history-based display allocation; never a roster assignment. */
  inferredPrincipal: string | null;
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
  unmappedEmployees: UnmappedTimestampEmployee[];
}

export interface TimestampOutletVisit {
  date: string;
  callTime: Date;
  callSequence: number;
  outletName: string;
  channel: string;
  territory: string;
  callOutcome: "Sale" | "No Sale";
  documents: number;
  sales: number;
  qty: number;
  cases: number | null;
  intervalMins: number | null;
  noSaleReason: string | null;
}

export interface TimestampRepTrend {
  label: string;
  calls: number;
  productiveCalls: number;
  outletsCovered: number;
  sales: number;
  qty: number;
  cases: number | null;
}

export interface TimestampRepDetailData {
  rep: { employeeCode: string; salesRep: string; region: string; salesRole: string } | null;
  overall: TimestampRoleStats;
  dailyTrend: TimestampRepTrend[];
  weeklyTrend: TimestampRepTrend[];
  visits: TimestampOutletVisit[];
}

/** Selectable Team Leader value for a rep whose EmployeeMaster.teamLeader is
 *  blank or who has no EmployeeMaster row at all — keeps them reachable via
 *  the Team Leader filter instead of being a permanent dead end (a NULL
 *  column value can never equal a specific selected name). */
const GENERAL_TEAM_LEADER = "General";

type SummaryRow = TimestampRepDaySummary;
interface RepRow { employeeCode: string; salesRep: string }
interface DateRow { date: string }
interface RegionRow { region: string }
interface TeamLeaderRow { teamLeader: string }
interface MetricRow extends TimestampRoleStats { salesRole: string | null }
interface UnmappedRow { employeeCode: string; salesRep: string; callsThisMonth: number; inferredPrincipal: string | null }
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

/** Dashboard-only eligibility, now used only for the standing unmapped-
 * employee worklist below (getTimestampSummary's unmappedRows) and by
 * Upfield's own queries (app/api/upfield-timestamps/*) for the one
 * genuinely day-divided figure they compute (coverage.averageOutletsPerDay).
 * Every other Timestamps query shows non-working-day activity like any
 * other day — see sourceQuery's own comment above. RepCall rows are
 * deliberately retained in Postgres either way and remain available to the
 * raw export endpoint regardless of this clause. */
export function kenyaWorkingDayClause(dateExpression: Prisma.Sql, range: { start: Date; end: Date }): Prisma.Sql {
  const holidays = kenyaPublicHolidaysInRange(range.start, range.end);
  if (holidays.length === 0) {
    return Prisma.sql`EXTRACT(ISODOW FROM ${dateExpression}) BETWEEN 1 AND 5`;
  }
  return Prisma.sql`
    EXTRACT(ISODOW FROM ${dateExpression}) BETWEEN 1 AND 5
    AND ${dateExpression} NOT IN (${Prisma.join(holidays.map((holiday) => Prisma.sql`${holiday}::date`))})
  `;
}

/** The global principal selector uses this normalized brand key, whereas
 * Timestamps stores the full Cost Centre name (for example, `Mars-Nairobi`). */
export function timestampPrincipalKey(principalKey: string): string {
  return normalizePrincipalKey(principalKey);
}

/** Tests the canonical absolute principal from Employee Roaster. Timestamps
 * are an operational Pine report, so a rep's complete day is never reassigned
 * according to a call's sale cost-centre or their multi-principal JPA
 * contribution allocation. */
function absolutePrincipalMatchClause(principalKey: string, absolutePrincipal: Prisma.Sql): Prisma.Sql {
  const selectorKey = timestampPrincipalKey(principalKey);
  return Prisma.sql`
    lower(regexp_replace(split_part(BTRIM(${absolutePrincipal}), '-', 1), '[^a-zA-Z0-9]', '', 'g')) = ${selectorKey}
  `;
}

/** The selected principal, read through the Team Leader. A Team Leader's reps sell more than one principal (one team can carry EFL,
 * Bidco, Bennet, Highchem and Milly Fruits), but the roster holds a single absolute principal per rep, so filtering on that alone
 * hid most of a team's day whenever a principal was chosen. A rep now matches when their Team Leader has an active assignment on
 * the principal, and the rep's whole day is then shown. Exported for tests. */
export function teamLeaderPrincipalMatchClause(principalKey: string): Prisma.Sql {
  const selectorKey = timestampPrincipalKey(principalKey);
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "TeamLeaderAssignment" tla
      JOIN "TeamLeader" tl ON tl.id = tla."teamLeaderId"
      WHERE tla.active
        AND (tl.id = em."teamLeaderId" OR tl.name = em."teamLeader")
        AND lower(regexp_replace(split_part(BTRIM(tla.principal), '-', 1), '[^a-zA-Z0-9]', '', 'g')) = ${selectorKey}
    )
  `;
}

/** A historical fallback for a true Employee Roaster gap only (rostered reps always use absolutePrincipal, including mornings before
 * their first sale). Two CTEs: `unmapped`, the reps with calls in the window and no Employee Roaster row (with their name and call
 * count), and `inferred`, each such rep's principal: the cost centre on most of their sale calls across all history, ties to the most
 * recent, then by name. Worked out once per rep. It used to be a LATERAL subquery evaluated for every call row, re-reading the rep's
 * whole history each time, which made every Timestamps load slow and a principal-filtered one time out. Exported for tests. */
export function unmappedPrincipalsCte(monthRange: { start: Date; end: Date }, scope: TeamLeaderScope | null, extraWhere: Prisma.Sql = EMPTY_SQL): Prisma.Sql {
  return Prisma.sql`
    unmapped AS (
      SELECT r."employeeCode" AS "employeeCode", MAX(r."salesRep") AS "salesRep", COUNT(*)::integer AS "callsThisMonth"
      FROM "RepCall" r
      LEFT JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"
      WHERE r.date >= ${monthRange.start} AND r.date < ${monthRange.end} AND em.id IS NULL ${extraWhere} ${scopeClause(scope)}
      GROUP BY r."employeeCode"
    ),
    inferred AS (
      SELECT DISTINCT ON (history."employeeCode") history."employeeCode" AS "employeeCode", BTRIM(cost_centre."value") AS principal
      FROM "RepCall" history
      JOIN unmapped u ON u."employeeCode" = history."employeeCode"
      CROSS JOIN LATERAL unnest(string_to_array(history."costCentresBought", ',')) AS cost_centre("value")
      WHERE history."callOutcome" = 'Sale' AND BTRIM(cost_centre."value") <> ''
      GROUP BY history."employeeCode", BTRIM(cost_centre."value")
      ORDER BY history."employeeCode", COUNT(*) DESC, MAX(history.date) DESC, BTRIM(cost_centre."value") ASC
    )
  `;
}

/** The reps a selected principal covers, worked out once per request instead of once per call row: rostered reps whose own roster
 * principal is the selected one or whose Team Leader has an active assignment on it, and unrostered reps whose inferred principal
 * (unmappedPrincipalsCte) is the selected one. The aggregate queries then filter calls by this list. */
export async function principalEmployeeCodes(principalKey: string, monthRange: { start: Date; end: Date }, scope: TeamLeaderScope | null): Promise<string[]> {
  const [rostered, unrostered] = await Promise.all([
    prisma.$queryRaw<{ employeeCode: string }[]>(Prisma.sql`
      SELECT em."employeeCode" AS "employeeCode"
      FROM "EmployeeMaster" em
      WHERE ${absolutePrincipalMatchClause(principalKey, Prisma.sql`em."absolutePrincipal"`)} OR ${teamLeaderPrincipalMatchClause(principalKey)}
    `),
    prisma.$queryRaw<{ employeeCode: string }[]>(Prisma.sql`
      WITH ${unmappedPrincipalsCte(monthRange, scope)}
      SELECT inferred."employeeCode" AS "employeeCode" FROM inferred
      WHERE ${absolutePrincipalMatchClause(principalKey, Prisma.sql`inferred.principal`)}
    `),
  ]);
  return [...new Set([...rostered, ...unrostered].map((row) => row.employeeCode))];
}

/** Scope restriction shared by every query below, factored out so the
 * unmapped-employees worklist (getTimestampSummary) can reuse it without
 * going through sourceQuery's principal branching. Exported for
 * lib/timeInTrade.ts's Pine source, which queries the same "RepCall r"
 * shape and needs the identical employeeCode-based restriction. */
export function scopeClause(scope: TeamLeaderScope | null): Prisma.Sql {
  return scope
    ? scope.employeeCodes.length > 0
      ? Prisma.sql`AND r."employeeCode" IN (${Prisma.join(scope.employeeCodes)})`
      : Prisma.sql`AND false`
    : EMPTY_SQL;
}

/** Produces a direct source relation and predicates for the dashboard's
 * aggregate queries. This deliberately avoids a wide MATERIALIZED CTE: on
 * the VPS, repeatedly reading that temporary relation was markedly slower
 * than independent grouped scans of the indexed RepCall table.
 *
 * Always LEFT JOINs EmployeeMaster — a rep with no EmployeeMaster row (a
 * genuinely new employee not yet in either roster source; confirmed live:
 * employee 1192, 63 real calls this month including productive ones, zero
 * roster row anywhere) must stay visible, not be silently dropped along with
 * every one of their calls, sale or no-sale, productive or not. Their sales
 * role/active status fall back to the call's own stored value / true; their
 * Team Leader falls back to the GENERAL_TEAM_LEADER bucket (see
 * selectedTeamLeaderClause) rather than requiring a roster match to appear
 * at all. Was an INNER JOIN + required `em.active` when a principal was
 * selected — the common case, since Timestamps shares the same global
 * principal selector used everywhere else in the app — which is exactly
 * what made an unmapped rep's whole day disappear. */
// Non-working days used to be filtered out of this query's own baseWhere,
// which removed them from both the visuals (charts/tables) and every KPI
// total built on top. They're visualised again now — a weekend/holiday with
// real activity shows in the chart and day-by-day table, and counts toward
// plain sums/counts (totalCalls, sales, qty, ...) like any other day. Only a
// genuine day-divided average should stay working-days-only; the one place
// that computes one from this data is client-side
// (components/views/timestamps/TimestampsPineView.tsx's
// buildRepMonthlyAverages, for hoursInDay/first-last-call/avgIntervalMins),
// which filters by lib/kenyaBusinessCalendar.ts's isKenyaWorkingDay itself.
async function sourceQuery(
  monthRange: { start: Date; end: Date },
  scope: TeamLeaderScope | null,
  principalKey: string | null
): Promise<{ from: Prisma.Sql; baseWhere: Prisma.Sql; salesRole: Prisma.Sql }> {
  const { start, end } = monthRange;
  const teamClause = scopeClause(scope);
  const from = Prisma.sql`FROM "RepCall" r LEFT JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"`;
  const salesRole = Prisma.sql`COALESCE(NULLIF(BTRIM(em."salesRole"), ''), r."salesRole")`;

  if (!principalKey) {
    return {
      from,
      baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} AND COALESCE(em.active, true) ${teamClause}`,
      salesRole,
    };
  }

  // Principal-scoped Timestamps follow the Team Leader: a rep is in when their own roster principal is the selected one, or when
  // their Team Leader has an active assignment on it, and then the rep's complete day is shown (never trimmed per call's sale
  // cost-centre, so a first call with no sale stays). A rep with no roster row, hence no principal or Team Leader to read,
  // correctly falls out of any one specific-principal filter (genuinely unknown, not guessable), but stays visible in the
  // unfiltered view above and in the General Team Leader bucket below.
  // The rule is per rep (roster principal, Team Leader assignment, or inferred principal), so the reps are resolved once
  // (principalEmployeeCodes) and calls filtered by that list.
  const codes = await principalEmployeeCodes(principalKey, monthRange, scope);
  const principalClause = codes.length > 0 ? Prisma.sql`AND r."employeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`AND false`;
  return {
    from,
    baseWhere: Prisma.sql`WHERE r.date >= ${start} AND r.date < ${end} AND COALESCE(em.active, true) ${principalClause} ${teamClause}`,
    salesRole,
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
  if (!filters.teamLeader) return EMPTY_SQL;
  // A NULL/blank em."teamLeader" can never equal a specific selected name —
  // GENERAL_TEAM_LEADER is the one value that must match that gap directly.
  if (filters.teamLeader === GENERAL_TEAM_LEADER) {
    return Prisma.sql`AND NULLIF(BTRIM(em."teamLeader"), '') IS NULL`;
  }
  return Prisma.sql`AND em."teamLeader" = ${filters.teamLeader}`;
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

function selectedRoleClause(filters: TimestampFilters, salesRole: Prisma.Sql): Prisma.Sql {
  return filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND ${salesRole} = ${filters.roleFilter}`;
}

function chartBucket(granularity: TimestampChartGranularity): Prisma.Sql {
  if (granularity === "Daily") return Prisma.sql`to_char(r.date, 'YYYY-MM-DD')`;
  if (granularity === "Weekly") return Prisma.sql`CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer`;
  // Pine persists Nairobi wall-clock values in UTC-shaped timestamp fields;
  // return the stored hour directly so chart buckets match the source clock.
  return Prisma.sql`EXTRACT(HOUR FROM r."callTime")::integer`;
}

function emptyStats(): TimestampRoleStats {
  return { totalCalls: 0, productiveCalls: 0, strikeRate: 0, outletsCovered: 0, avgIntervalMins: null, sales: 0, qty: 0, cases: 0 };
}

/** Compact aggregate payload for the interactive Timestamps dashboard. Raw
 * RepCall detail stays in Postgres, while the browser receives only KPI,
 * chart, filter, and rep-day rows (roughly 3k rather than 94k records). */
export async function getTimestampSummary(
  now: Date,
  scope: TeamLeaderScope | null,
  filters: TimestampFilters
): Promise<TimestampSummaryData> {
  const monthRange = resolveMonthWindow(now, filters.month);
  const { from, baseWhere, salesRole } = await sourceQuery(monthRange, scope, filters.principalKey);
  const dateClause = selectedDateClause(filters);
  const repClause = selectedRepClause(filters);
  const regionClause = selectedRegionClause(filters);
  const teamLeaderClause = selectedTeamLeaderClause(filters);
  const roleClause = selectedRoleClause(filters, salesRole);
  const salesExpression = Prisma.sql`r.sales`;
  const bucket = chartBucket(filters.chartGranularity);

  const [dateRows, regionRows, teamLeaderRows, repRows, summaryRows, metricRows, chartRows, unmappedRows] = await Promise.all([
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
      SELECT DISTINCT COALESCE(NULLIF(BTRIM(em."teamLeader"), ''), ${GENERAL_TEAM_LEADER}) AS "teamLeader"
      ${from} ${baseWhere} ${dateClause} ${roleClause}
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
        MIN(r."firstCallOfDay") AS "firstCall",
        MAX(r."lastCallOfDay") AS "lastCall",
        ROUND((EXTRACT(EPOCH FROM MAX(r."lastCallOfDay") - MIN(r."firstCallOfDay")) / 3600)::numeric, 2)::double precision AS "hoursInDay",
        COUNT(*)::integer AS "callsMade",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision AS "strikeRatePct",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales,
        COALESCE(SUM(r.qty), 0)::double precision AS qty,
        CASE
          WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') = 0 THEN 0::double precision
          WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale' AND r.cases IS NULL) > 0 THEN NULL
          ELSE COALESCE(SUM(r.cases) FILTER (WHERE r."callOutcome" = 'Sale'), 0)::double precision
        END AS cases
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
        COALESCE(SUM(${salesExpression}), 0)::double precision AS sales,
        COALESCE(SUM(r.qty), 0)::double precision AS qty,
        CASE
          WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') = 0 THEN 0::double precision
          WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale' AND r.cases IS NULL) > 0 THEN NULL
          ELSE COALESCE(SUM(r.cases) FILTER (WHERE r."callOutcome" = 'Sale'), 0)::double precision
        END AS cases
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY GROUPING SETS ((${salesRole}), ())
    `),
    prisma.$queryRaw<ChartRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, ${salesRole} AS "salesRole", COUNT(*)::integer AS calls
      ${from} ${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}
      GROUP BY 1, 2
      ORDER BY bucket, "salesRole"
    `),
    // Standing worklist, independent of the UI's ad-hoc filters (date/region/
    // teamLeader/rep/role) — this month's window + the session's own scope
    // only, so it doesn't disappear the moment someone filters to a single
    // date. See UnmappedTimestampEmployee's own comment for why this exists.
    prisma.$queryRaw<UnmappedRow[]>(Prisma.sql`
      WITH ${unmappedPrincipalsCte(monthRange, scope, Prisma.sql`AND ${kenyaWorkingDayClause(Prisma.sql`r.date::date`, monthRange)}`)}
      SELECT u."employeeCode" AS "employeeCode", u."salesRep" AS "salesRep", u."callsThisMonth" AS "callsThisMonth", inferred.principal AS "inferredPrincipal"
      FROM unmapped u
      LEFT JOIN inferred ON inferred."employeeCode" = u."employeeCode"
      ORDER BY "callsThisMonth" DESC
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
    unmappedEmployees: unmappedRows,
  };
}

// unstable_cache derives its key from the arguments the returned function is
// actually called with — every field here must be plain JSON (a bare Date is
// fine, it has its own toJSON; a Set is not, it serializes to "{}" and would
// silently collapse distinct scopes onto the same cache entry). scope's only
// field getTimestampSummary reads is employeeCodes (checked above), so that's
// the only piece that crosses the cache boundary — the Set-bearing
// TeamLeaderScope itself never does. `null` vs `[]` for employeeCodes is
// preserved (null = unrestricted/admin; [] = restricted to nothing).
const getTimestampSummaryCachedInner = unstable_cache(
  async (nowIso: string, employeeCodes: string[] | null, filters: TimestampFilters): Promise<TimestampSummaryData> => {
    const scope: TeamLeaderScope | null = employeeCodes
      ? { teamLeaderId: null, supervisorId: null, teamLeaderIds: [], principals: [], employeeCodes, normalizedNames: new Set() }
      : null;
    return getTimestampSummary(new Date(nowIso), scope, filters);
  },
  ["timestamp-summary"],
  // Short TTL, not tag-invalidated: the underlying sync itself only runs
  // every 30s-5min (continuous-sync-worker.ts), so a 60s cache is invisible
  // to users but collapses concurrent identical requests into one DB round
  // trip — the same problem class as the dataset overlay fix above, just
  // handled with a TTL instead of a bound query since there's no natural
  // "only fetch what changed" filter for a live rolling window.
  { revalidate: 60 }
);

/** Cached entry point for the compact Timestamps summary — same signature
 *  and behavior as getTimestampSummary, minus the cost of re-running it for
 *  every request within the same rounded-to-the-minute cache window. Callers
 *  should round `now` themselves (see app/api/timestamps/summary/route.ts)
 *  so requests within the same minute actually share a cache key. */
export async function getTimestampSummaryCached(now: Date, scope: TeamLeaderScope | null, filters: TimestampFilters): Promise<TimestampSummaryData> {
  return getTimestampSummaryCachedInner(now.toISOString(), scope ? scope.employeeCodes : null, filters);
}

/** Detailed, ordered visit journey for one selected sales rep. It intentionally
 * stays behind a separate endpoint so the summary dashboard remains compact;
 * opening a rep is the explicit signal that outlet-level customer detail is
 * useful. */
export async function getTimestampRepDetail(
  now: Date,
  scope: TeamLeaderScope | null,
  filters: TimestampFilters
): Promise<TimestampRepDetailData> {
  if (!filters.employeeCode) return { rep: null, overall: emptyStats(), dailyTrend: [], weeklyTrend: [], visits: [] };

  const monthRange = resolveMonthWindow(now, filters.month);
  const { from, baseWhere, salesRole } = await sourceQuery(monthRange, scope, filters.principalKey);
  const dateClause = selectedDateClause(filters);
  const repClause = selectedRepClause(filters);
  const regionClause = selectedRegionClause(filters);
  const teamLeaderClause = selectedTeamLeaderClause(filters);
  const roleClause = selectedRoleClause(filters, salesRole);
  const filtersSql = Prisma.sql`${baseWhere} ${dateClause} ${repClause} ${regionClause} ${teamLeaderClause} ${roleClause}`;
  const casesExpression = Prisma.sql`
    CASE
      WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') = 0 THEN 0::double precision
      WHEN COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale' AND r.cases IS NULL) > 0 THEN NULL
      ELSE COALESCE(SUM(r.cases) FILTER (WHERE r."callOutcome" = 'Sale'), 0)::double precision
    END
  `;

  type DetailMetricRow = TimestampRoleStats;
  interface DetailRepRow { employeeCode: string; salesRep: string; region: string; salesRole: string }
  type DetailTrendRow = TimestampRepTrend;
  type DetailVisitRow = TimestampOutletVisit;

  const [repRows, metricRows, dailyTrend, weeklyTrend, visits] = await Promise.all([
    prisma.$queryRaw<DetailRepRow[]>(Prisma.sql`
      SELECT r."employeeCode" AS "employeeCode", MAX(r."salesRep") AS "salesRep", MAX(r.region) AS region, MAX(${salesRole}) AS "salesRole"
      ${from} ${filtersSql}
      GROUP BY r."employeeCode"
    `),
    prisma.$queryRaw<DetailMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::integer AS "totalCalls",
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        COALESCE(ROUND((COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 1)::double precision, 0) AS "strikeRate",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        ROUND(AVG(r."intervalMins")::numeric, 1)::double precision AS "avgIntervalMins",
        COALESCE(SUM(r.sales), 0)::double precision AS sales,
        COALESCE(SUM(r.qty), 0)::double precision AS qty,
        ${casesExpression} AS cases
      ${from} ${filtersSql}
    `),
    prisma.$queryRaw<DetailTrendRow[]>(Prisma.sql`
      SELECT
        to_char(r.date, 'YYYY-MM-DD') AS label,
        COUNT(*)::integer AS calls,
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        COALESCE(SUM(r.sales), 0)::double precision AS sales,
        COALESCE(SUM(r.qty), 0)::double precision AS qty,
        ${casesExpression} AS cases
      ${from} ${filtersSql}
      GROUP BY r.date
      ORDER BY r.date
    `),
    prisma.$queryRaw<DetailTrendRow[]>(Prisma.sql`
      SELECT
        CONCAT('Week ', CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer) AS label,
        COUNT(*)::integer AS calls,
        COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::integer AS "productiveCalls",
        COUNT(DISTINCT r."outletId")::integer AS "outletsCovered",
        COALESCE(SUM(r.sales), 0)::double precision AS sales,
        COALESCE(SUM(r.qty), 0)::double precision AS qty,
        ${casesExpression} AS cases
      ${from} ${filtersSql}
      GROUP BY CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer
      ORDER BY CEIL(EXTRACT(DAY FROM r.date)::numeric / 7)::integer
    `),
    prisma.$queryRaw<DetailVisitRow[]>(Prisma.sql`
      SELECT
        to_char(r.date, 'YYYY-MM-DD') AS date,
        r."callTime" AS "callTime",
        r."callSequence" AS "callSequence",
        r."outletName" AS "outletName",
        r.channel,
        r.territory,
        r."callOutcome" AS "callOutcome",
        r.documents,
        r.sales,
        r.qty,
        r.cases,
        r."intervalMins" AS "intervalMins",
        r."noSaleReason" AS "noSaleReason"
      ${from} ${filtersSql}
      ORDER BY r.date, r."callTime", r."callSequence"
    `),
  ]);

  return { rep: repRows[0] ?? null, overall: metricRows[0] ?? emptyStats(), dailyTrend, weeklyTrend, visits };
}
